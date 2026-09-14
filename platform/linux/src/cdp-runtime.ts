import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { discoverCodexCdp } from "../../../packages/codex-adapter/src/cdp.js";

const fail = (code: string): never => {
  throw new Error(code);
};
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function waitForLinuxRenderer(
  state: LinuxCdpRuntimeState,
  options: {
    timeoutMs?: number;
    inspect?: typeof verifyLinuxCdpRuntime;
    discover?: typeof discoverCodexCdp;
    sleep?: typeof pause;
  } = {},
): Promise<void> {
  const deadline = Date.now() + (options.timeoutMs ?? 30000);
  for (;;) {
    await (options.inspect ?? verifyLinuxCdpRuntime)(state);
    try {
      await (options.discover ?? discoverCodexCdp)(state.port);
      return;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "GOAL_PROGRESS_CDP_APP_RENDERER_NOT_FOUND")
        throw error;
      if (Date.now() >= deadline) throw new Error("LINUX_RENDERER_START_TIMEOUT", { cause: error });
      await (options.sleep ?? pause)(100);
    }
  }
}
export interface LinuxCodexApp {
  realAppPath: string;
  realExecutablePath: string;
  shortVersion: string;
  metadataSha256: string;
}
export interface LinuxProcessIdentity {
  pid: number;
  uid: number;
  executablePath: string;
  processStartTicks: string;
  bootId: string;
  argv: string[];
}
export interface LinuxCdpRuntimeState {
  schemaVersion: 1;
  platform: "linux";
  appPath: string;
  executablePath: string;
  appVersion: string;
  metadataSha256: string;
  mainPid: number;
  uid: number;
  processStartTicks: string;
  bootId: string;
  port: number;
  launchId: string;
}
export async function inspectLinuxCodexApp(
  executablePath = process.env.GOAL_PROGRESS_CODEX_EXECUTABLE ?? "/usr/lib/chatgpt/ChatGPT",
): Promise<LinuxCodexApp> {
  if (!isAbsolute(executablePath)) fail("LINUX_APP_PATH_INVALID");
  const executable = await realpath(executablePath);
  const appPath = dirname(executable);
  for (const path of [
    executable,
    appPath,
    resolve(appPath, "resources"),
    resolve(appPath, "resources/linux-package-metadata.json"),
    resolve(appPath, "resources/app.asar"),
  ]) {
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o022) !== 0 ||
      ![0, process.getuid?.()].includes(metadata.uid)
    )
      fail("LINUX_APP_PERMISSIONS_INVALID");
  }
  await access(executable, constants.X_OK);
  const text = await readFile(resolve(appPath, "resources/linux-package-metadata.json"), "utf8");
  const metadata = JSON.parse(text) as Record<string, unknown>;
  if (
    metadata.codexAppBrand !== "chatgpt" ||
    metadata.codexBuildFlavor !== "prod" ||
    typeof metadata.version !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(metadata.version)
  )
    fail("LINUX_APP_METADATA_INVALID");
  return {
    realAppPath: appPath,
    realExecutablePath: executable,
    shortVersion: metadata.version as string,
    metadataSha256: digest(text),
  };
}
export function parseLinuxProcessStat(text: string): string {
  const close = text.lastIndexOf(")");
  const ticks = text
    .slice(close + 2)
    .trim()
    .split(/\s+/u)[19];
  if (close < 0 || !ticks || !/^\d+$/u.test(ticks)) fail("LINUX_PROCESS_STAT_INVALID");
  return ticks ?? fail("LINUX_PROCESS_STAT_INVALID");
}
export async function inspectLinuxProcess(pid: number): Promise<LinuxProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid < 1) fail("LINUX_PID_INVALID");
  const root = `/proc/${pid}`;
  const before = parseLinuxProcessStat(await readFile(`${root}/stat`, "utf8"));
  const [metadata, executablePath, command, bootId] = await Promise.all([
    lstat(root),
    readlink(`${root}/exe`),
    readFile(`${root}/cmdline`),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ]);
  if (before !== parseLinuxProcessStat(await readFile(`${root}/stat`, "utf8")))
    fail("LINUX_PROCESS_IDENTITY_CHANGED");
  return {
    pid,
    uid: metadata.uid,
    executablePath,
    processStartTicks: before,
    bootId: bootId.trim(),
    argv: command.toString().split("\0").filter(Boolean),
  };
}
export function linuxListenerInodes(table: string, port: number): string[] {
  const matches = table
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/u))
    .filter(
      (fields) =>
        fields[3] === "0A" && Number.parseInt(fields[1]?.split(":")[1] ?? "", 16) === port,
    );
  if (!matches.length || matches.some((fields) => fields[1]?.split(":")[0] !== "0100007F"))
    fail("LINUX_CDP_LOOPBACK_REQUIRED");
  return matches.map((fields) => fields[9] ?? fail("LINUX_SOCKET_TABLE_INVALID"));
}
export async function readLinuxCdpRuntimeState(path: string): Promise<LinuxCdpRuntimeState> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    fail("LINUX_CDP_STATE_PERMISSIONS_INVALID");
  const value = JSON.parse(await readFile(path, "utf8")) as LinuxCdpRuntimeState;
  if (
    value.schemaVersion !== 1 ||
    value.platform !== "linux" ||
    !Number.isSafeInteger(value.port) ||
    value.port < 1024 ||
    value.port > 65535 ||
    !Number.isSafeInteger(value.mainPid) ||
    value.mainPid < 1 ||
    value.uid !== process.getuid?.() ||
    typeof value.executablePath !== "string" ||
    !isAbsolute(value.executablePath) ||
    typeof value.appPath !== "string" ||
    !isAbsolute(value.appPath) ||
    !/^\d+$/u.test(value.processStartTicks) ||
    !/^[a-f\d-]{36}$/u.test(value.bootId) ||
    !/^[a-f\d-]{36}$/u.test(value.launchId) ||
    !/^[a-f\d]{64}$/u.test(value.metadataSha256)
  )
    fail("LINUX_CDP_STATE_INVALID");
  return value;
}
export async function verifyLinuxCdpRuntime(
  state: LinuxCdpRuntimeState,
): Promise<{ app: LinuxCodexApp; process: LinuxProcessIdentity }> {
  const app = await inspectLinuxCodexApp(state.executablePath);
  const identity = await inspectLinuxProcess(state.mainPid);
  if (
    app.realAppPath !== state.appPath ||
    app.shortVersion !== state.appVersion ||
    app.metadataSha256 !== state.metadataSha256 ||
    identity.uid !== process.getuid?.() ||
    identity.uid !== state.uid ||
    identity.executablePath !== app.realExecutablePath ||
    identity.processStartTicks !== state.processStartTicks ||
    identity.bootId !== state.bootId ||
    identity.argv.some((arg) => arg.includes("--type="))
  )
    fail("LINUX_CDP_PROCESS_MISMATCH");
  // Owl rewrites argv into a process title after startup. Verify the actual
  // listening address and socket owner instead of treating argv as immutable.
  const tcp = await readFile(`/proc/${state.mainPid}/net/tcp`, "utf8");
  const tcp6 = await readFile(`/proc/${state.mainPid}/net/tcp6`, "utf8");
  const inodes = linuxListenerInodes(`${tcp}\n${tcp6.split("\n").slice(1).join("\n")}`, state.port);
  const descriptors = await readdir(`/proc/${state.mainPid}/fd`);
  const owned = await Promise.all(
    descriptors.map(async (fd) => {
      try {
        return await readlink(`/proc/${state.mainPid}/fd/${fd}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw error;
      }
    }),
  );
  if (inodes.some((inode) => !owned.includes(`socket:[${inode}]`)))
    fail("LINUX_CDP_SOCKET_OWNER_MISMATCH");
  const final = await inspectLinuxProcess(state.mainPid);
  if (
    final.processStartTicks !== identity.processStartTicks ||
    final.executablePath !== identity.executablePath
  )
    fail("LINUX_CDP_PROCESS_CHANGED");
  const response = await fetch(`http://127.0.0.1:${state.port}/json/version`, {
    signal: AbortSignal.timeout(2000),
  });
  const version = (await response.json()) as { webSocketDebuggerUrl?: string };
  const url = new URL(version.webSocketDebuggerUrl ?? "invalid");
  if (
    !response.ok ||
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    Number(url.port) !== state.port
  )
    fail("LINUX_CDP_ENDPOINT_INVALID");
  return { app, process: identity };
}
