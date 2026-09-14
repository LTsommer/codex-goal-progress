// Explicit real-client test; intentionally excluded from tests/*.test.ts.
// Run: xvfb-run -a env GOAL_PROGRESS_RUN_OWL_INTEGRATION=1 node --import tsx tests/linux-owl-runtime.integration.ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import {
  inspectLinuxCodexApp,
  inspectLinuxProcess,
  type LinuxCdpRuntimeState,
  verifyLinuxCdpRuntime,
} from "../platform/linux/src/runtime.js";

assert.equal(process.platform, "linux");
assert.equal(process.env.GOAL_PROGRESS_RUN_OWL_INTEGRATION, "1", "Explicit opt-in required");
assert.ok(process.env.DISPLAY, "Run inside a new xvfb-run display");
const root = await mkdtemp("/tmp/gp-owl-integration-");
const profile = `${root}/profile`;
await mkdir(profile);
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
const app = await inspectLinuxCodexApp();
const log = await open(`${root}/launch.log`, "w", 0o600);
const child = spawn(
  app.realExecutablePath,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
  ],
  {
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: {
      ...process.env,
      CODEX_HOME: `${root}/codex`,
      CODEX_ELECTRON_USER_DATA_PATH: profile,
      XDG_CONFIG_HOME: `${root}/config`,
      XDG_CACHE_HOME: `${root}/cache`,
      XDG_DATA_HOME: `${root}/data`,
    },
  },
);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence: unknown[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  assert.ok(child.pid);
  const initial = await inspectLinuxProcess(child.pid);
  evidence.push({ phase: "spawn", identity: initial });
  const state: LinuxCdpRuntimeState = {
    schemaVersion: 1,
    platform: "linux",
    appPath: app.realAppPath,
    executablePath: app.realExecutablePath,
    appVersion: app.shortVersion,
    metadataSha256: app.metadataSha256,
    mainPid: child.pid,
    uid: initial.uid,
    processStartTicks: initial.processStartTicks,
    bootId: initial.bootId,
    port,
    launchId: randomUUID(),
  };
  let rewritten = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, "Owl exited before verification");
    assert.equal(child.signalCode, null, "Owl was signaled before verification");
    const identity = await inspectLinuxProcess(child.pid);
    if (
      identity.argv.length === 1 &&
      identity.argv[0]?.includes(`--remote-debugging-port=${port}`)
    ) {
      evidence.push({ phase: "rewritten", identity });
      rewritten = true;
      break;
    }
    await pause(100);
  }
  assert.ok(rewritten, "Expected real Owl argv rewrite was not observed");
  // Allow listener startup, but do not hide an identity or ownership rejection.
  for (let attempt = 0; ; attempt++) {
    try {
      const verified = await verifyLinuxCdpRuntime(state);
      evidence.push({ phase: "verified", identity: verified.process });
      break;
    } catch (error) {
      if (
        attempt >= 99 ||
        !(error instanceof Error) ||
        error.message !== "LINUX_CDP_LOOPBACK_REQUIRED"
      )
        throw error;
      await pause(100);
    }
  }
  await assert.rejects(
    verifyLinuxCdpRuntime({
      ...state,
      processStartTicks: String(BigInt(state.processStartTicks) + 1n),
    }),
    /LINUX_CDP_PROCESS_MISMATCH/,
  );
  // The observed browser owns only its chosen CDP port; port 1 is not that listener.
  await assert.rejects(
    verifyLinuxCdpRuntime({ ...state, port: 1 }),
    /LINUX_CDP_LOOPBACK_REQUIRED|LINUX_CDP_SOCKET_OWNER_MISMATCH/,
  );
  evidence.push({
    phase: "negative-checks",
    wrongStartTicksRejected: true,
    wrongPortRejected: true,
  });
  console.log(JSON.stringify({ ok: true, evidenceRoot: root, pid: child.pid, port }));
} finally {
  // The detached process group was created by this test, not discovered from user processes.
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGTERM");
    for (
      let attempt = 0;
      attempt < 50 && child.exitCode === null && child.signalCode === null;
      attempt++
    )
      await pause(100);
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
  }
  evidence.push({ phase: "cleanup", exitCode: child.exitCode, signalCode: child.signalCode });
  await writeFile(`${root}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  await log.close();
}
