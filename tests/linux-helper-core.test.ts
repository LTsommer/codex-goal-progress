import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import type { GoalProgressDoctorResult } from "../packages/host/src/helper-doctor.js";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import { acquireHelperInstanceLock, resolveGoalProgressPaths } from "../packages/store/src/index.js";

// Exercise the actual CLI, Linux renderer discovery, socket and shutdown signal.
// No desktop process, user configuration or authenticated Codex session is required.
test("Linux Helper keeps core IPC available without CDP and releases its lease on shutdown", {
  skip: process.platform !== "linux",
  timeout: 15000,
}, async () => {
  const root = await mkdtemp("/tmp/gp-linux-core-");
  const paths = resolveGoalProgressPaths({ root });
  const child = spawn(process.execPath, ["--import", "tsx", resolve("packages/host/src/index.ts"), "serve"], {
    env: { ...process.env, GOAL_PROGRESS_ROOT: root, CODEX_HOME: resolve(root, "codex") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 12000);
  const client = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "doctor", timeoutMs: 1000 });
  try {
    await assert.rejects(access(paths.cdpRuntimePath), { code: "ENOENT" });
    let ready = false;
    const deadline = Date.now() + 8000;
    while (!ready && Date.now() < deadline) {
      assert.equal(child.exitCode, null, stderr);
      assert.equal(child.signalCode, null, stderr);
      try {
        const response = await client.request({ method: "ping", params: {} });
        const health = response.result as { ready: boolean; status: string; pid: number };
        ready = health.ready;
        if (ready) {
          assert.equal(health.status, "ok");
          assert.equal(health.pid, child.pid);
        }
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("unavailable")) throw error;
      }
      if (!ready) await new Promise((done) => setTimeout(done, 50));
    }
    assert.equal(ready, true, `Core IPC did not become ready: ${stderr}`);
    const doctor = (await client.request({ method: "doctor", params: {} })).result as GoalProgressDoctorResult;
    assert.equal(doctor.helper.running, true);
    assert.equal(doctor.ipc.reachable, true);
    assert.deepEqual(doctor.storeSmoke, { checked: true, readable: true, sessionCount: 0, code: null });
    assert.notEqual(doctor.runtime.renderer.componentVisible, true);
    assert.ok(doctor.runtime.lastErrorCode, "Missing CDP must remain observable in renderer diagnostics");
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
    await assert.rejects(access(paths.helperSocketPath), { code: "ENOENT" });
    await assert.rejects(access(paths.helperPidPath), { code: "ENOENT" });
    assert.deepEqual(await readdir(paths.helperLocksRoot), []);
    const replacement = await acquireHelperInstanceLock(paths);
    await replacement.release();
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
