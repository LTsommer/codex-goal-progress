import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import { GOAL_PROGRESS_RELEASE_VERSION } from "../packages/contracts/src/release-version.js";
import { resolveGoalProgressPaths } from "../packages/store/src/index.js";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
import { desktopExecQuote } from "../platform/linux/src/desktop-entry.js";
import { runGoalProgressCli } from "../platform/linux/src/cli.js";
import {
  ensureLinuxSourceRuntime,
  inspectLinuxProcess,
  inspectLinuxSourceRuntime,
  linuxListenerInodes,
  linuxSystemdQuote,
  parseLinuxProcessStat,
  prepareLinuxSourceRuntime,
  withLinuxRuntimeOperation,
} from "../platform/linux/src/runtime.js";

// Uses the real Linux flock executable for install/uninstall operation serialization.
test("Linux setup prepares owned files without starting services; missing CDP remains a failure", {
  skip: process.platform !== "linux",
}, async () => {
  const temp = await realpath(await mkdtemp("/tmp/gp-linux-runtime-"));
  const previous = { ...process.env };
  const sessionBus = createServer();
  try {
    const root = resolve(temp, "codex-$`/plugins/data/codex-goal-progress-test-local");
    const runtime = resolve(root, "source-runtime");
    const app = resolve(temp, "app");
    const bin = resolve(temp, "fake-bin");
    for (const path of [runtime, resolve(app, "resources"), bin])
      await mkdir(path, { recursive: true, mode: 0o700 });
    await writeFile(resolve(app, "ChatGPT"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    await writeFile(resolve(app, "resources/app.asar"), "test app", { mode: 0o600 });
    await writeFile(
      resolve(app, "resources/linux-package-metadata.json"),
      JSON.stringify({
        codexAppBrand: "chatgpt",
        codexBuildFlavor: "prod",
        version: "26.901.51231",
      }),
      { mode: 0o600 },
    );
    const files: Record<string, { path: string; bytes: number; sha256: string }> = {};
    for (const path of [
      "bin/goal-progress",
      "bin/goal-progress.cjs",
      "bin/node-runtime.sh",
      "renderer/goal-progress.js",
      "renderer/goal-progress.manifest.json",
    ]) {
      await mkdir(resolve(runtime, path, ".."), { recursive: true });
      await writeFile(resolve(runtime, path), "test", { mode: 0o700 });
      files[path] = { path, bytes: 4, sha256: createHash("sha256").update("test").digest("hex") };
    }
    await writeFile(
      resolve(runtime, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, releaseVersion: GOAL_PROGRESS_RELEASE_VERSION, files }),
    );
    const session = resolve(temp, "user-session");
    await mkdir(session, { mode: 0o700 });
    await new Promise<void>((done, reject) => {
      sessionBus.once("error", reject);
      sessionBus.listen(resolve(session, "bus"), done);
    });
    await writeFile(resolve(bin, "loginctl"), `#!/bin/sh\nprintf '%s\\n' '${session}'\n`, {
      mode: 0o700,
    });
    const log = resolve(temp, "calls");
    await writeFile(
      resolve(bin, "systemctl"),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$2" in\nshow) printf '%s\\n' '${temp}/config/systemd/user/codex-goal-progress.service';;\nis-active) echo inactive;;\nesac\n`,
      { mode: 0o700 },
    );
    Object.assign(process.env, {
      PATH: bin,
      XDG_CONFIG_HOME: resolve(temp, "config"),
      XDG_DATA_HOME: resolve(temp, "desktop-data"),
      GOAL_PROGRESS_PLUGIN_DATA: root,
      GOAL_PROGRESS_PLUGIN_MARKETPLACE: "test-local",
      GOAL_PROGRESS_ROOT: root,
      GOAL_PROGRESS_CODEX_HOME: resolve(temp, "codex-$`"),
      GOAL_PROGRESS_SOURCE_RUNTIME_ROOT: runtime,
      GOAL_PROGRESS_SOURCE_LAUNCHER: resolve(runtime, "bin/goal-progress"),
      GOAL_PROGRESS_SOURCE_BUNDLE: resolve(runtime, "bin/goal-progress.cjs"),
      GOAL_PROGRESS_RENDERER_BUNDLE_DIR: resolve(runtime, "renderer"),
      GOAL_PROGRESS_CODEX_EXECUTABLE: resolve(app, "ChatGPT"),
    });
    const systemDesktopPath = resolve(temp, "system-chatgpt.desktop");
    await writeFile(systemDesktopPath, "[Desktop Entry]\nName=ChatGPT\nExec=chatgpt %U\n");
    const normalPath = resolve(temp, "desktop-data/applications/chatgpt.desktop");
    await mkdir(resolve(normalPath, ".."), { recursive: true });
    const originalDesktop =
      "[Desktop Entry]\nName=My ChatGPT\nExec=chatgpt %U\nIcon=my-icon\nMimeType=x-scheme-handler/codex;\n";
    await writeFile(normalPath, originalDesktop, { mode: 0o600 });
    const prepared = await prepareLinuxSourceRuntime({ systemDesktopPath });
    const wrapperBefore = await readFile(String(prepared.details.wrapper), "utf8");
    assert.match(wrapperBefore, /__linux-launch -- "\$@"/u);
    const normalContents = await readFile(normalPath, "utf8");
    assert.match(normalContents, /Name=My ChatGPT/u);
    assert.match(normalContents, /Icon=my-icon/u);
    assert.match(normalContents, /%U/u);
    const sequence: string[] = [];
    await Promise.all(
      [1, 2].map((id) =>
        withLinuxRuntimeOperation(async () => {
          sequence.push(`start${id}`);
          await new Promise((done) => setTimeout(done, 10));
          sequence.push(`end${id}`);
        }),
      ),
    );
    assert.match(sequence.join(","), /^(start1,end1,start2,end2|start2,end2,start1,end1)$/u);
    assert.equal(prepared.ok, true);
    assert.equal(prepared.details.installationComplete, false);
    const service = await readFile(String(prepared.details.service), "utf8");
    assert.match(service, /GOAL_PROGRESS_SOURCE_RUNTIME=1/u);
    assert.match(service, /PATH=/u);
    const callsBefore = await readFile(log, "utf8");
    assert.doesNotMatch(callsBefore, /enable|start|restart/u);
    const setup = await ensureLinuxSourceRuntime();
    assert.equal(setup.ok, false);
    assert.equal(setup.code, "LINUX_HELPER_SERVICE_INVALID");
    assert.match(await readFile(log, "utf8"), /enable --now codex-goal-progress.service/u);
    const verify = await inspectLinuxSourceRuntime("verify");
    assert.equal(verify.ok, false);
    assert.equal(verify.code, "LINUX_HELPER_SERVICE_INVALID");
    // A real Helper process supplies IPC and /proc identity; only systemd is a fixture.
    // This reaches the same ensure result consumed by the source bootstrap entry.
    const helper = spawn(process.execPath, ["--import", "tsx", resolve("packages/host/src/index.ts"), "serve"], {
      env: { ...process.env, PATH: previous.PATH, GOAL_PROGRESS_RUNTIME_DIGEST: createHash("sha256").update("test").digest("hex") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let helperError = "";
    helper.stdout.resume();
    helper.stderr.on("data", (bytes) => { helperError += bytes; });
    const helperExited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
      helper.once("error", reject);
      helper.once("exit", (code, signal) => done({ code, signal }));
    });
    const helperTimeout = setTimeout(() => helper.kill("SIGKILL"), 15000);
    const inactiveSystemctl = await readFile(resolve(bin, "systemctl"), "utf8");
    try {
      const client = new GoalProgressIpcClient(resolveGoalProgressPaths({ root }).helperSocketPath, { clientKind: "doctor", timeoutMs: 1000 });
      let ready = false;
      for (let attempt = 0; attempt < 100 && !ready; attempt++) {
        assert.equal(helper.exitCode, null, helperError);
        try { ready = ((await client.request({ method: "ping", params: {} })).result as { ready: boolean }).ready; }
        catch (error) { if (!(error instanceof Error) || !error.message.includes("unavailable")) throw error; }
        if (!ready) await new Promise((done) => setTimeout(done, 50));
      }
      assert.equal(ready, true, helperError);
      await writeFile(resolve(bin, "systemctl"), [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> '${log}'`,
        'case "$*" in',
        `*--property=FragmentPath*) printf '%s\\n' '${prepared.details.service}';;`,
        `*--property=MainPID*) printf '%s\\n' '${helper.pid}';;`,
        '*--property=ActiveState*|*is-active*) echo active;;',
        'esac',
        '',
      ].join("\n"));
      const coreSetup = await ensureLinuxSourceRuntime();
      assert.equal(coreSetup.ok, true, JSON.stringify(coreSetup));
      assert.equal(coreSetup.code, "SETUP_CORE_READY");
      assert.equal(coreSetup.details.helperReady, true);
      assert.equal(coreSetup.details.cdpReady, false);
      assert.ok(coreSetup.details.uiError);
      const uiVerify = await inspectLinuxSourceRuntime("verify");
      assert.equal(uiVerify.ok, false);
      assert.equal(uiVerify.code, "LINUX_CDP_NOT_VERIFIED");
      helper.kill("SIGTERM");
      assert.deepEqual(await helperExited, { code: 0, signal: null }, helperError);
    } finally {
      clearTimeout(helperTimeout);
      if (helper.exitCode === null && helper.signalCode === null) helper.kill("SIGKILL");
      await helperExited;
      await writeFile(resolve(bin, "systemctl"), inactiveSystemctl);
    }
    const backupPath = resolve(root, "runtime/linux-desktop-backup.json");
    const backupBytes = await readFile(backupPath);
    for (const missingPath of [resolve(root, "runtime/linux-installation.json"), normalPath]) {
      const before = await readFile(missingPath);
      await rm(missingPath);
      await assert.rejects(prepareLinuxSourceRuntime({ systemDesktopPath }), /ENOENT/u);
      assert.deepEqual(await readFile(backupPath), backupBytes);
      await writeFile(missingPath, before, { mode: 0o600 });
    }
    const desktopPath = String(prepared.details.desktop);
    const desktopBefore = await readFile(desktopPath, "utf8");
    assert.ok(desktopBefore.split("\n").includes(`Exec=${desktopExecQuote(String(prepared.details.wrapper))}`));
    const serviceBefore = await readFile(String(prepared.details.service), "utf8");
    await writeFile(desktopPath, "foreign owner\n");
    await assert.rejects(prepareLinuxSourceRuntime({ systemDesktopPath }), /LINUX_INSTALLATION_OWNER_MISMATCH/u);
    assert.equal(await readFile(String(prepared.details.service), "utf8"), serviceBefore);
    assert.equal(await readFile(desktopPath, "utf8"), "foreign owner\n");
    await writeFile(desktopPath, desktopBefore);
    const systemctlPath = resolve(bin, "systemctl");
    const originalSystemctl = await readFile(systemctlPath, "utf8");
    const failureMarker = resolve(temp, "failed-once");
    await writeFile(
      systemctlPath,
      `#!/bin/sh\nif [ "$2" = daemon-reload ] && [ ! -f '${failureMarker}' ]; then : > '${failureMarker}'; exit 1; fi\nexit 0\n`,
    );
    process.env.GOAL_PROGRESS_NODE_BINARY = "/changed/node";
    await assert.rejects(prepareLinuxSourceRuntime({ systemDesktopPath }), /LINUX_SYSTEMD_FAILED/u);
    assert.equal(await readFile(String(prepared.details.service), "utf8"), serviceBefore);
    assert.equal(await readFile(desktopPath, "utf8"), desktopBefore);
    await writeFile(systemctlPath, originalSystemctl);
    await writeFile(String(prepared.details.wrapper), "#!/bin/sh\nexit 0\n");
    const tampered = await inspectLinuxSourceRuntime("verify");
    assert.equal(tampered.ok, false);
    assert.equal(tampered.code, "LINUX_INSTALL_ENTRYPOINT_CHANGED");
    await chmod(resolve(app, "resources/app.asar"), 0o666);
    await assert.rejects(prepareLinuxSourceRuntime({ systemDesktopPath }), /LINUX_APP_PERMISSIONS_INVALID/u);
    await chmod(resolve(app, "resources/app.asar"), 0o600);
    await writeFile(String(prepared.details.wrapper), wrapperBefore);
    await prepareLinuxSourceRuntime({ systemDesktopPath });
    const pluginRemoved = resolve(temp, "plugin-removed");
    await writeFile(
      resolve(app, "resources/codex"),
      `#!/bin/sh\ncase "$2" in\nlist) if [ -f '${pluginRemoved}' ]; then echo '{"installed":[]}'; else echo '{"installed":[{"pluginId":"codex-goal-progress@test-local","installed":true}]}'; fi;;\nremove) : > '${pluginRemoved}'; echo '{}';;\nesac\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      runGoalProgressCli(["uninstall", "--json", "--keep-history"]),
      /LINUX_CLI_OPTION_INVALID/u,
    );
    await runGoalProgressCli(["uninstall", "--json", "--delete-history"]);
    assert.equal(await readFile(normalPath, "utf8"), originalDesktop);
    await assert.rejects(readFile(root), /ENOENT/u);
    let releaseFirst: (() => void) | undefined;
    let enteredFirst: (() => void) | undefined;
    const entered = new Promise<void>((done) => {
      enteredFirst = done;
    });
    const release = new Promise<void>((done) => {
      releaseFirst = done;
    });
    const order: string[] = [];
    const first = withLinuxRuntimeOperation(async () => {
      order.push("start1");
      enteredFirst?.();
      await release;
      order.push("end1");
    });
    await entered;
    const actor = (id: number) =>
      withLinuxRuntimeOperation(async () => {
        order.push(`start${id}`);
        await new Promise((done) => setTimeout(done, 10));
        order.push(`end${id}`);
      });
    const second = actor(2);
    await new Promise((done) => setTimeout(done, 30));
    // Simulate uninstall and reinstall while one old-inode waiter already exists.
    await mkdir(root, { recursive: true });
    await rm(root, { recursive: true });
    await mkdir(root, { recursive: true });
    const third = actor(3);
    await new Promise((done) => setTimeout(done, 30));
    assert.deepEqual(order, ["start1"]);
    releaseFirst?.();
    await Promise.all([first, second, third]);
    assert.equal(order.length, 6);
    for (let i = 0; i < order.length; i += 2)
      assert.equal(order[i]?.replace("start", "end"), order[i + 1]);
  } finally {
    if (sessionBus.listening) await new Promise<void>((done) => sessionBus.close(() => done()));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await rm(temp, { recursive: true, force: true });
  }
});

test("Linux proc stat handles process names containing closing parentheses", () => {
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "12345", "0"];
  assert.equal(parseLinuxProcessStat(`45 (name with ) spaces) ${fields.join(" ")}`), "12345");
  assert.throws(() => parseLinuxProcessStat("45 (broken) S 0"), /LINUX_PROCESS_STAT_INVALID/u);
});
test("CDP socket table requires every matching listening socket to be IPv4 loopback", () => {
  const header = "sl local_address rem_address st tx_queue tr retrnsmt uid timeout inode";
  const row = (address: string, state = "0A") =>
    `0: ${address}:2401 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000 0 1234`;
  assert.deepEqual(linuxListenerInodes(`${header}\n${row("0100007F")}`, 9217), ["1234"]);
  for (const address of ["00000000", "0100000A", "00000000000000000000000001000000"]) {
    assert.throws(
      () => linuxListenerInodes(`${header}\n${row("0100007F")}\n${row(address)}`, 9217),
      /LINUX_CDP_LOOPBACK_REQUIRED/u,
    );
  }
  assert.throws(
    () => linuxListenerInodes(`${header}\n${row("0100007F", "01")}`, 9217),
    /LINUX_CDP_LOOPBACK_REQUIRED/u,
  );
});
test("systemd serialization escapes specifiers and rejects injected lines", () => {
  assert.equal(linuxSystemdQuote('/tmp/a %n "b"'), '"/tmp/a %%n \\"b\\""');
  assert.throws(
    () => linuxSystemdQuote("path\nExecStart=unexpected"),
    /LINUX_SERVICE_VALUE_INVALID/u,
  );
});
test("Linux process identity reads the actual current process", {
  skip: process.platform !== "linux",
}, async () => {
  const identity = await inspectLinuxProcess(process.pid);
  assert.equal(identity.pid, process.pid);
  assert.equal(identity.uid, process.getuid?.());
  assert.match(identity.processStartTicks, /^\d+$/u);
  assert.match(identity.bootId, /^[a-f\d-]{36}$/u);
  assert.equal(identity.executablePath, process.execPath);
});

test("Linux CLI rejects another platform before reading install environment or acquiring a lock", {
  skip: process.platform === "linux",
}, async () => {
  await assert.rejects(runGoalProgressCli(["__linux-prepare"]), /GOAL_PROGRESS_LINUX_REQUIRED/u);
});
