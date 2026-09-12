import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import { resolveGoalProgressPaths } from "../packages/store/src/paths.js";
import {
  ensureHelperSocketDirectory,
  resolveHelperSocketPath,
} from "../packages/store/src/socket-path.cjs";

test("socket policy preserves valid paths and bounds long UTF-8 paths with stable per-user isolation", () => {
  const shortRoot = "/tmp/gp-short";
  assert.equal(
    resolveHelperSocketPath(shortRoot, "darwin", 501),
    `${shortRoot}/runtime/helper.sock`,
  );
  const root =
    "/Users/liaotianzhihao/.codex/plugins/data/codex-goal-progress-codex-goal-progress-local";
  assert.equal(Buffer.byteLength(`${root}/runtime/helper.sock`), 107);
  const socket = resolveHelperSocketPath(root, "darwin", 501);
  assert.ok(Buffer.byteLength(socket) <= 103);
  assert.equal(socket, resolveHelperSocketPath(root, "darwin", 501));
  assert.notEqual(socket, resolveHelperSocketPath(`${root}-other`, "darwin", 501));
  assert.notEqual(socket, resolveHelperSocketPath(root, "darwin", 502));
  assert.ok(
    Buffer.byteLength(resolveHelperSocketPath(`/tmp/${"中文".repeat(50)}`, "darwin", 501)) <= 103,
  );
});

test("long production-shaped data roots can serve real Helper IPC without relocating state", async () => {
  const base = await mkdtemp("/tmp/gp-long-");
  const root = join(
    base,
    "codex-goal-progress-codex-goal-progress-local",
    "source-installation-with-long-name",
  );
  const paths = resolveGoalProgressPaths({ root });
  const original = join(root, "runtime/helper.sock");
  assert.ok(Buffer.byteLength(original) > 104);
  assert.equal(paths.stateRoot, join(root, "state/v1"));
  assert.equal(paths.runtimeRoot, join(root, "runtime"));
  const helper = new GoalProgressHelper({
    paths,
    visibleThreadRecoveryDelaysMs: [],
    viewModelSink: { clear: async () => {}, publish: async () => {} },
  });
  try {
    await mkdir(paths.runtimeRoot, { recursive: true, mode: 0o700 });
    // Establish the original failure before testing the changed path, on the same OS and Node.
    await assert.rejects(
      new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(original, () => server.close(() => resolve()));
      }),
      { code: "EINVAL" },
    );
    await helper.start();
    const client = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "doctor" });
    const reply = await client.request({ method: "ping", params: {} });
    assert.equal(reply.ok, true);
    const metadata = await lstat(paths.helperSocketPath);
    assert.ok(metadata.isSocket());
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal((await lstat(dirname(paths.helperSocketPath))).mode & 0o777, 0o700);
    assert.equal(paths.helperSocketPath, resolveHelperSocketPath(root));
  } finally {
    await helper.stop();
    await rm(base, { recursive: true, force: true });
  }
});

test("socket server never follows a precreated symlink or uses a public directory", async () => {
  const base = await mkdtemp("/tmp/gp-dir-");
  try {
    const target = join(base, "target");
    await mkdir(target, { mode: 0o700 });
    await symlink(target, join(base, "link"));
    await assert.rejects(
      ensureHelperSocketDirectory(join(base, "link/helper.sock")),
      /IPC_SOCKET_DIRECTORY_UNSAFE/,
    );
    await mkdir(join(base, "public"), { mode: 0o755 });
    await assert.rejects(
      ensureHelperSocketDirectory(join(base, "public/helper.sock")),
      /IPC_SOCKET_DIRECTORY_UNSAFE/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("bootstrap and bundled source share exactly the same socket policy", async () => {
  const source = await readFile(new URL("../packages/store/src/socket-path.cjs", import.meta.url));
  const packaged = await readFile(
    new URL("../runtime/source/packages/store/src/socket-path.cjs", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    createHash("sha256").update(packaged).digest("hex"),
  );
});
