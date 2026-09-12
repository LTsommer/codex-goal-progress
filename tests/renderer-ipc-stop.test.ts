import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import { RendererTargetManager } from "../packages/host/src/renderer-target-manager.js";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import { resolveGoalProgressPaths } from "../packages/store/src/index.js";

test("stop cancels renderer IPC waiting on UI before draining in-flight requests", {
  timeout: 2000,
}, async () => {
  const root = await mkdtemp("/tmp/gp-render-stop-");
  const paths = resolveGoalProgressPaths({ root });
  let reads = 0;
  let entered!: () => void;
  const pendingRead = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const manager = new RendererTargetManager({
    connector: async () => ({
      initialTargets: [{ targetId: "target", type: "page", url: "app://-/index.html" }],
      onTargetInfo: () => () => {},
      onTargetDestroyed: () => () => {},
      close: async () => {},
      connectTarget: async () => ({
        clear: async () => {},
        close: async () => {},
        publish: async () => {},
        recoverVisibleThreadId: async () => {
          reads++;
          if (reads > 1) {
            entered();
            return new Promise<never>(() => {});
          }
          return "task-thread";
        },
      }),
    }),
  });
  const helper = new GoalProgressHelper({
    paths,
    viewModelSink: manager,
    visibleThreadRecoveryDelaysMs: [],
  });
  try {
    await helper.start();
    while (reads === 0) await new Promise((resolve) => setImmediate(resolve));
    const client = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "cdp" });
    const request = client
      .request({
        method: "renderer.visible-thread",
        params: { targetId: "target", threadId: "task-thread" },
      })
      .catch(() => undefined);
    await pendingRead;
    await helper.stop();
    await request;
    assert.deepEqual(manager.targetIds(), []);
  } finally {
    await helper.stop();
    await rm(root, { recursive: true, force: true });
  }
});
