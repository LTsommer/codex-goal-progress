import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireHelperInstanceLock,
  resolveGoalProgressPaths,
} from "../packages/store/src/index.js";

test("Linux lock rejects a live owner and reclaims a mismatching start identity", {
  skip: process.platform !== "linux",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "gp-linux-lock-"));
  const paths = resolveGoalProgressPaths({ root });
  try {
    const lock = await acquireHelperInstanceLock(paths);
    await assert.rejects(acquireHelperInstanceLock(paths), { code: "HELPER_ALREADY_RUNNING" });
    const identity = JSON.parse(await readFile(lock.identityPath, "utf8"));
    // Real live PID with an old incarnation: PID liveness alone is insufficient.
    identity.processStartedAtMs -= 60_000;
    await writeFile(lock.identityPath, JSON.stringify(identity));
    const replacement = await acquireHelperInstanceLock(paths);
    await lock.release();
    await assert.rejects(acquireHelperInstanceLock(paths), { code: "HELPER_ALREADY_RUNNING" });
    await replacement.release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
