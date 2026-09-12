import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import {
  type GoalProgressStartupListener,
  MacosStartupHandoffController,
} from "../packages/host/src/startup-listener.js";
import { resolveGoalProgressPaths } from "../packages/store/src/index.js";

for (const failure of [
  null,
  "RENDERER_TARGET_SOURCE_UNAVAILABLE",
  "GOAL_PROGRESS_CODEX_APP_SIGNATURE_INVALID",
  "HANDOFF_INSPECTION_FAILED",
]) {
  test(`startup handoff and UI recovery have independent results: ${failure}`, {
    timeout: 3000,
  }, async () => {
    const root = await mkdtemp("/tmp/gp-ui-result-");
    const paths = resolveGoalProgressPaths({ root });
    let handler: Parameters<GoalProgressStartupListener["start"]>[0] | undefined;
    let reconnectCalls = 0;
    let recoveryCalls = 0;
    let afterFailure = false;
    let retryObserved!: () => void;
    const retried = new Promise<void>((resolve) => {
      retryObserved = resolve;
    });
    const successfulHandoff = {
      schemaVersion: 1 as const,
      pid: 11111,
      action: "complete" as const,
      code: "STARTUP_HANDOFF_COMPLETE",
      mainPid: 22222,
      port: 60001,
      launchId: "00000000-0000-4000-8000-000000000001",
    };
    const handoff = new MacosStartupHandoffController({ paths });
    // Only the OS/process boundary is replaced. Exercise the actual Helper and multi-target Publisher.
    handoff.handle = async () => {
      if (failure === "HANDOFF_INSPECTION_FAILED") throw new Error(failure);
      return successfulHandoff;
    };
    const helper = new GoalProgressHelper({
      paths,
      sourcePluginRuntime: false,
      startupHandoff: handoff,
      visibleThreadRecoveryDelaysMs: [0],
      startupListener: {
        start: (callback) => {
          handler = callback;
        },
        health: () => ({ running: true, ready: true, pid: 123, pendingPid: 11111 }),
        isPending: () => true,
        waitUntilReady: async () => true,
        stop: async () => {},
      },
      viewModelSink: {
        clear: async () => {},
        clearTarget: async () => {},
        setTargetThread: async () => {},
        publish: async () => {},
        publishTarget: async () => {},
        recoverVisibleTargets: async () => {
          if (afterFailure) {
            recoveryCalls++;
            retryObserved();
          }
          return [];
        },
        reconnect: async () => {
          reconnectCalls++;
          if (failure) {
            afterFailure = true;
            throw new Error(failure);
          }
          return undefined;
        },
      },
    });
    try {
      await helper.start();
      // Let the independent cold-start UI attempt finish before injecting the launch event.
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(handler);
      const result = await handler({
        schemaVersion: 1,
        event: "codex.willLaunch",
        pid: 11111,
        bundleId: "com.openai.codex",
        appPath: "/Applications/ChatGPT.app",
        executablePath: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        launchedAt: new Date().toISOString(),
        deadlineAtMs: Date.now() + 20000,
      });
      if (failure === "HANDOFF_INSPECTION_FAILED") {
        assert.equal(result.code, "STARTUP_HANDLER_FAILED");
        assert.equal(reconnectCalls, 0);
      } else {
        assert.deepEqual(result, successfulHandoff);
        assert.equal(reconnectCalls, 1);
      }
      if (failure === "RENDERER_TARGET_SOURCE_UNAVAILABLE") {
        await retried;
        assert.equal(recoveryCalls, 1, "Use the existing bounded recovery schedule");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(recoveryCalls, 0, "Do not retry signature rejection or successful recovery");
      }
      const entries = (await readFile(paths.helperLogPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const launch = entries.find((entry) => entry.event === "startup.handoff");
      assert.equal(launch.code, result.code);
      if (failure === "HANDOFF_INSPECTION_FAILED") assert.equal(launch.causeCode, failure);
      else {
        assert.equal(launch.mainPid, 22222);
        assert.equal(launch.port, 60001);
      }
      const ui = entries.filter((entry) => entry.event === "startup.ui-recovery");
      const uiFailed = failure !== null && failure !== "HANDOFF_INSPECTION_FAILED";
      assert.equal(ui.length, uiFailed ? 1 : 0);
      if (uiFailed) {
        assert.equal(ui[0].code, "STARTUP_UI_RECOVERY_FAILED");
        assert.equal(ui[0].causeCode, failure);
        assert.equal(ui[0].launchId, successfulHandoff.launchId);
      }
    } finally {
      await helper.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
}
