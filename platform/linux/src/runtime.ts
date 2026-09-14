import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, readdir, readFile } from "node:fs/promises";
import net from "node:net";
import { resolve } from "node:path";
import { GoalProgressIpcClient } from "../../../packages/ipc/src/index.js";
import { atomicWriteFile } from "../../../packages/store/src/index.js";
import {
  inspectLinuxCodexApp,
  inspectLinuxProcess,
  type LinuxCdpRuntimeState,
  type LinuxProcessIdentity,
  readLinuxCdpRuntimeState,
  verifyLinuxCdpRuntime,
} from "./cdp-runtime.js";
import { validateDesktopArguments } from "./desktop-entry.js";
import {
  configuration,
  type LinuxRuntimeResult,
  result,
  SERVICE,
  systemctl,
  verifyFiles,
  verifyInstalledEntrypoints,
} from "./source-installation.js";
import { linuxGraphicalSessionEnvironment } from "./user-session.js";

export {
  inspectLinuxCodexApp,
  inspectLinuxProcess,
  type LinuxCdpRuntimeState,
  type LinuxCodexApp,
  type LinuxProcessIdentity,
  linuxListenerInodes,
  parseLinuxProcessStat,
  readLinuxCdpRuntimeState,
  verifyLinuxCdpRuntime,
} from "./cdp-runtime.js";
export {
  type LinuxRuntimeResult,
  linuxSystemdQuote,
  prepareLinuxSourceRuntime,
  uninstallLinuxSourceRuntime,
} from "./source-installation.js";

const fail = (code: string): never => {
  throw new Error(code);
};
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function withLinuxRuntimeOperation<T>(work: () => Promise<T>): Promise<T> {
  const c = configuration();
  // Coordination survives uninstall so old waiters and a new installation share one inode.
  const coordinationRoot = resolve(c.codexHome, "plugins/goal-progress-coordination");
  await mkdir(coordinationRoot, { recursive: true, mode: 0o700 });
  const directory = await lstat(coordinationRoot);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o077) !== 0
  )
    fail("LINUX_OPERATION_LOCK_DIRECTORY_INVALID");
  const path = resolve(coordinationRoot, `${digest(c.root)}.lock`);
  const { open } = await import("node:fs/promises");
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0)
      fail("LINUX_OPERATION_LOCK_INVALID");
  } catch (error) {
    await file.close();
    throw error;
  }
  const lock = spawn(
    "/bin/sh",
    [
      "-c",
      "/usr/bin/flock --exclusive --timeout 30 3 || exit $?; printf 'locked\\n'; /bin/cat >/dev/null",
    ],
    { stdio: ["pipe", "pipe", "pipe", file.fd] },
  );
  await file.close();
  const stdin = lock.stdin ?? fail("LINUX_OPERATION_LOCK_PIPE_MISSING");
  const stdout = lock.stdout ?? fail("LINUX_OPERATION_LOCK_PIPE_MISSING");
  const exited = new Promise<void>((done) => lock.once("close", () => done()));
  try {
    await new Promise<void>((done, reject) => {
      lock.once("error", reject);
      lock.once("exit", (code) => reject(new Error(`LINUX_OPERATION_LOCK_FAILED: ${code}`)));
      stdout.once("data", (data: Buffer) =>
        data.toString() === "locked\n"
          ? done()
          : reject(new Error("LINUX_OPERATION_LOCK_PROTOCOL_INVALID")),
      );
    });
    return await work();
  } finally {
    stdin.end();
    await exited;
  }
}

export interface LinuxHelperSession {
  schemaVersion: 1;
  pid: number;
  processStartTicks: string;
  launchId: string;
  bundleDigest: string;
}
export function linuxHelperSessionMatches(
  previous: LinuxHelperSession | null,
  current: LinuxHelperSession,
): boolean {
  return (
    previous?.schemaVersion === 1 &&
    previous.pid === current.pid &&
    previous.processStartTicks === current.processStartTicks &&
    previous.launchId === current.launchId &&
    previous.bundleDigest === current.bundleDigest
  );
}
async function currentHelperProcess(): Promise<LinuxProcessIdentity> {
  const pidText = systemctl(["show", SERVICE, "--property=MainPID", "--value"]);
  if (!/^[1-9]\d*$/u.test(pidText)) fail("LINUX_HELPER_PID_INVALID");
  const identity = await inspectLinuxProcess(Number(pidText));
  if (identity.uid !== process.getuid?.()) fail("LINUX_HELPER_PROCESS_OWNER_INVALID");
  return identity;
}
async function readHelperSession(path: string): Promise<LinuxHelperSession | null> {
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      (metadata.mode & 0o077) !== 0
    )
      fail("LINUX_HELPER_SESSION_PERMISSIONS_INVALID");
    const value = JSON.parse(await readFile(path, "utf8")) as LinuxHelperSession;
    if (
      value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.pid) ||
      value.pid < 1 ||
      !/^\d+$/u.test(value.processStartTicks) ||
      !/^[a-f\d-]{36}$/u.test(value.launchId) ||
      !/^[a-f\d]{64}$/u.test(value.bundleDigest)
    )
      fail("LINUX_HELPER_SESSION_INVALID");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function runningHelperDigest(): Promise<string | null> {
  const before = await currentHelperProcess();
  const pid = before.pid;
  const environment = await readFile(`/proc/${pid}/environ`);
  const value = environment
    .toString()
    .split("\0")
    .find((item) => item.startsWith("GOAL_PROGRESS_RUNTIME_DIGEST="))
    ?.slice("GOAL_PROGRESS_RUNTIME_DIGEST=".length);
  const after = await inspectLinuxProcess(pid);
  if (
    before.processStartTicks !== after.processStartTicks ||
    before.executablePath !== after.executablePath
  )
    fail("LINUX_HELPER_PROCESS_CHANGED");
  if (value === undefined) return null;
  if (!/^[a-f\d]{64}$/u.test(value)) fail("LINUX_HELPER_RUNTIME_DIGEST_INVALID");
  return value;
}
export async function inspectLinuxSourceRuntime(
  command: "doctor" | "verify",
  requireRenderer = command === "verify",
): Promise<LinuxRuntimeResult> {
  try {
    const c = configuration();
    await verifyFiles();
    await verifyInstalledEntrypoints();
    if (
      systemctl(["show", SERVICE, "--property=FragmentPath", "--value"]) !== c.service ||
      systemctl(["is-active", SERVICE]) !== "active"
    )
      fail("LINUX_HELPER_SERVICE_INVALID");
    if ((await runningHelperDigest()) !== digest(await readFile(c.bundle)))
      fail("LINUX_HELPER_RUNTIME_STALE");
    const ping = await new GoalProgressIpcClient(c.paths.helperSocketPath, {
      clientKind: "doctor",
      timeoutMs: 2000,
    }).request({ method: "ping", params: {} });
    const health = ping.result as { status?: string; ready?: boolean } | null;
    if (health?.status !== "ok" || health.ready !== true) fail("LINUX_HELPER_NOT_READY");
    const doctor = await new GoalProgressIpcClient(c.paths.helperSocketPath, {
      clientKind: "doctor",
      timeoutMs: 5000,
    }).request({ method: "doctor", params: {} });
    const report = doctor.result as {
      runtime?: {
        renderer?: {
          capabilitySupported?: boolean;
          componentVisible?: boolean;
          componentCount?: number;
          currentThreadMatched?: boolean;
        };
      };
    };
    let cdpReady = false;
    let uiError: string | null = null;
    try {
      await verifyLinuxCdpRuntime(await readLinuxCdpRuntimeState(c.paths.cdpRuntimePath));
      cdpReady = true;
    } catch (error) {
      uiError = error instanceof Error ? error.message : String(error);
    }
    const details = {
      helperReady: true,
      cdpReady,
      uiError,
      startupMode: "managed-desktop-entry",
      service: c.service,
      doctor: report,
    };
    if (requireRenderer && !cdpReady)
      return {
        ...result(command, false, "LINUX_CDP_NOT_VERIFIED", false, details),
        nextStep:
          "Use the managed desktop entry; restarting an existing desktop requires explicit approval.",
      };
    const renderer = report?.runtime?.renderer;
    if (
      requireRenderer &&
      (renderer?.capabilitySupported !== true ||
        renderer.componentVisible !== true ||
        renderer.componentCount !== 1 ||
        renderer.currentThreadMatched !== true)
    )
      return {
        ...result(command, false, "LINUX_RENDERER_NOT_VERIFIED", false, details),
        nextStep: "Activate Goal Progress for a real task in the desktop, then run Verify again.",
      };
    return {
      ...result(command, true, command === "doctor" ? "DOCTOR_OK" : "VERIFY_OK", false, details),
      nextStep: cdpReady
        ? null
        : "Core service is ready; use the managed desktop entry to restore UI. Restart requires explicit approval.",
    };
  } catch (error) {
    return result(
      command,
      false,
      error instanceof Error ? error.message : "LINUX_INSPECTION_FAILED",
      false,
    );
  }
}
export async function launchLinuxCodexManaged(
  options: { restartCodex?: boolean; args?: readonly string[] } = {},
): Promise<LinuxCdpRuntimeState> {
  const c = configuration();
  const app = await inspectLinuxCodexApp();
  const desktopArgs = validateDesktopArguments(options.args ?? []);
  let graphicalEnvironment: NodeJS.ProcessEnv | undefined;
  const requireGraphicalEnvironment = () =>
    (graphicalEnvironment ??= linuxGraphicalSessionEnvironment());
  const main: LinuxProcessIdentity[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      const identity = await inspectLinuxProcess(Number(entry));
      if (
        identity.uid === process.getuid?.() &&
        identity.executablePath === app.realExecutablePath &&
        !identity.argv.some((arg) => arg.includes("--type="))
      )
        main.push(identity);
    } catch (error) {
      if (!["ENOENT", "EACCES", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? ""))
        throw error;
    }
  }
  if (main.length > 1) fail("LINUX_CODEX_MAIN_AMBIGUOUS");
  if (main.length) {
    let verifiedExisting = false;
    try {
      const state = await readLinuxCdpRuntimeState(c.paths.cdpRuntimePath);
      await verifyLinuxCdpRuntime(state);
      verifiedExisting = true;
      if (!options.restartCodex) {
        // Wait for Electron single-instance forwarding to finish before releasing the launch lock.
        await new Promise<void>((done, reject) => {
          const forwarded = spawn(app.realExecutablePath, desktopArgs, { stdio: "ignore" });
          let timeoutError: Error | undefined;
          let killTimer: NodeJS.Timeout | undefined;
          const timeout = setTimeout(() => {
            timeoutError = new Error("LINUX_DESKTOP_FORWARD_TIMEOUT");
            forwarded.kill("SIGTERM");
            killTimer = setTimeout(() => forwarded.kill("SIGKILL"), 2000);
          }, 10000);
          const clear = () => {
            clearTimeout(timeout);
            if (killTimer) clearTimeout(killTimer);
          };
          forwarded.once("error", (error) => {
            clear();
            reject(error);
          });
          forwarded.once("close", (code, signal) => {
            clear();
            if (timeoutError) reject(timeoutError);
            else if (code !== 0)
              reject(new Error(`LINUX_DESKTOP_FORWARD_FAILED: ${code ?? signal}`));
            else done();
          });
        });
        return state;
      }
    } catch (error) {
      if (verifiedExisting) throw error;
      if (!options.restartCodex)
        fail(
          `GOAL_PROGRESS_SOURCE_RESTART_REQUIRED: ${error instanceof Error ? error.message : "CDP unavailable"}`,
        );
    }
    requireGraphicalEnvironment();
    const current = main[0] ?? fail("LINUX_CODEX_MAIN_MISSING");
    const checked = await inspectLinuxProcess(current.pid);
    if (
      checked.processStartTicks !== current.processStartTicks ||
      checked.executablePath !== current.executablePath
    )
      fail("LINUX_RESTART_PROCESS_CHANGED");
    process.kill(current.pid, "SIGTERM");
    for (let i = 0; i < 100; i++) {
      try {
        await inspectLinuxProcess(current.pid);
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) break;
        throw error;
      }
      if (i === 99) fail("LINUX_CODEX_STOP_TIMEOUT");
      await pause(100);
    }
  }
  requireGraphicalEnvironment();
  const port = await new Promise<number>((done, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("LINUX_PORT_ALLOCATION_FAILED"));
        return;
      }
      server.close((error) => (error ? reject(error) : done(address.port)));
    });
  });
  const child = spawn(
    app.realExecutablePath,
    [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1", ...desktopArgs],
    { detached: true, stdio: "ignore", env: graphicalEnvironment },
  );
  await new Promise<void>((done, reject) => {
    child.once("spawn", done);
    child.once("error", reject);
  });
  child.unref();
  let launchedIdentity: LinuxProcessIdentity | undefined;
  try {
    const identity = await inspectLinuxProcess(child.pid ?? fail("LINUX_SPAWN_PID_MISSING"));
    launchedIdentity = identity;
    const state: LinuxCdpRuntimeState = {
      schemaVersion: 1,
      platform: "linux",
      appPath: app.realAppPath,
      executablePath: app.realExecutablePath,
      appVersion: app.shortVersion,
      metadataSha256: app.metadataSha256,
      mainPid: identity.pid,
      uid: identity.uid,
      processStartTicks: identity.processStartTicks,
      bootId: identity.bootId,
      port,
      launchId: randomUUID(),
    };
    for (let i = 0; i < 100; i++) {
      try {
        await verifyLinuxCdpRuntime(state);
        await mkdir(c.paths.runtimeRoot, { recursive: true, mode: 0o700 });
        await atomicWriteFile(c.paths.cdpRuntimePath, `${JSON.stringify(state)}\n`);
        await chmod(c.paths.cdpRuntimePath, 0o600);
        return state;
      } catch (error) {
        if (i === 99) throw error;
        await pause(100);
      }
    }
    return fail("LINUX_CDP_START_TIMEOUT");
  } catch (error) {
    if (launchedIdentity) {
      try {
        const current = await inspectLinuxProcess(launchedIdentity.pid);
        if (
          current.processStartTicks !== launchedIdentity.processStartTicks ||
          current.executablePath !== launchedIdentity.executablePath
        )
          fail("LINUX_CDP_CLEANUP_IDENTITY_CHANGED");
        process.kill(current.pid, "SIGTERM");
      } catch (cleanup) {
        if (!["ENOENT", "ESRCH"].includes((cleanup as NodeJS.ErrnoException).code ?? ""))
          throw new Error("LINUX_CDP_CLEANUP_FAILED", { cause: cleanup });
      }
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    throw error;
  }
}
export async function ensureLinuxSourceRuntime(
  options: { restartCodex?: boolean } = {},
): Promise<LinuxRuntimeResult> {
  try {
    const c = configuration();
    await verifyFiles();
    await verifyInstalledEntrypoints();
    const receiptPath = resolve(c.paths.runtimeRoot, "linux-helper-session.json");
    const bundleDigest = digest(await readFile(c.bundle));
    const activeState = systemctl(["show", SERVICE, "--property=ActiveState", "--value"]);
    let restarted = false;
    if (activeState === "active" && (await runningHelperDigest()) !== bundleDigest) {
      systemctl(["restart", SERVICE]);
      restarted = true;
    }
    // Core IPC must become available even when the desktop/CDP is absent.
    systemctl(["enable", "--now", SERVICE]);
    if (options.restartCodex) await launchLinuxCodexManaged(options);
    let state: LinuxCdpRuntimeState | null = null;
    try {
      const candidate = await readLinuxCdpRuntimeState(c.paths.cdpRuntimePath);
      await verifyLinuxCdpRuntime(candidate);
      state = candidate;
    } catch {
      // Doctor reports the precise UI failure without making it a core startup prerequisite.
    }
    const sessionFor = (identity: LinuxProcessIdentity): LinuxHelperSession => ({
      schemaVersion: 1,
      pid: identity.pid,
      processStartTicks: identity.processStartTicks,
      launchId: state?.launchId ?? fail("LINUX_HELPER_SESSION_DESKTOP_REQUIRED"),
      bundleDigest,
    });
    if (state && activeState === "active" && !restarted) {
      const identity = await currentHelperProcess();
      if (!linuxHelperSessionMatches(await readHelperSession(receiptPath), sessionFor(identity)))
        systemctl(["restart", SERVICE]);
    }
    for (let i = 0; i < 40; i++) {
      const health = await inspectLinuxSourceRuntime("doctor", false);
      if (health.ok) {
        if (state && health.details.cdpReady === true) {
          const receipt = sessionFor(await currentHelperProcess());
          if (!linuxHelperSessionMatches(await readHelperSession(receiptPath), receipt)) {
            await atomicWriteFile(receiptPath, `${JSON.stringify(receipt)}\n`);
            await chmod(receiptPath, 0o600);
          }
        }
        if (health.details.cdpReady !== true)
          return {
            ...health,
            command: "install",
            ok: true,
            code: "SETUP_CORE_READY",
            changed: true,
          };
        return { ...health, command: "install", code: "SETUP_OK", changed: true };
      }
      if (i === 39) return { ...health, command: "install", changed: true };
      await pause(250);
    }
  } catch (error) {
    return result(
      "install",
      false,
      error instanceof Error ? error.message : "LINUX_INSTALL_FAILED",
      true,
    );
  }
  return fail("LINUX_INSTALL_FAILED");
}
