import assert from "node:assert/strict";
import test from "node:test";
import {
  RendererTargetManager,
  type RendererTargetSource,
} from "../packages/host/src/renderer-target-manager.js";

test("stopping during source discovery cancels startup and closes a late source", {
  timeout: 1000,
}, async () => {
  let resolveSource!: (source: RendererTargetSource) => void;
  let connections = 0;
  let closes = 0;
  const manager = new RendererTargetManager({
    connector: () =>
      new Promise((resolve) => {
        resolveSource = resolve;
      }),
  });
  const startup = manager.start();
  const rejected = assert.rejects(startup, /RENDERER_TARGET_SOURCE_UNAVAILABLE/);
  await manager.close();
  await rejected;
  resolveSource({
    initialTargets: [{ targetId: "late", type: "page", url: "app://-/index.html" }],
    onTargetInfo: () => () => {},
    onTargetDestroyed: () => () => {},
    connectTarget: async () => {
      connections++;
      throw new Error("must not connect after close");
    },
    close: async () => {
      closes++;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(connections, 0);
  assert.deepEqual(manager.targetIds(), []);
});

test("stopping during target connection closes a late bridge without activating it", {
  timeout: 1000,
}, async () => {
  let resolveBridge!: (bridge: {
    clear(): Promise<void>;
    close(): Promise<void>;
    publish(): Promise<void>;
  }) => void;
  let ready = 0;
  let closes = 0;
  const manager = new RendererTargetManager({
    onTargetReady: () => {
      ready++;
    },
    connector: async () => ({
      initialTargets: [{ targetId: "late", type: "page", url: "app://-/index.html" }],
      onTargetInfo: () => () => {},
      onTargetDestroyed: () => () => {},
      close: async () => {},
      connectTarget: () =>
        new Promise((resolve) => {
          resolveBridge = resolve;
        }),
    }),
  });
  const startup = manager.start();
  const rejected = assert.rejects(startup, /RENDERER_TARGET/);
  while (!resolveBridge) await new Promise((resolve) => setImmediate(resolve));
  await manager.close();
  await rejected;
  resolveBridge({
    clear: async () => {},
    publish: async () => {},
    close: async () => {
      closes++;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal(ready, 0);
  assert.deepEqual(manager.targetIds(), []);
});
