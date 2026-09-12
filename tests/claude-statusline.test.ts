import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { claudeSessionKey } from "../packages/claude-code/src/paths.js";
import { renderClaudeStatusLine } from "../packages/claude-code/src/statusline.js";
import { GoalContractSchema } from "../packages/contracts/src/index.js";
import {
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
} from "../packages/store/src/paths.js";

test("status line reads matching snapshots without mutation, hides unknown percentage and isolates sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "gp-statusline-"));
  try {
    assert.equal(await renderClaudeStatusLine({ session_id: "one" }, root), "");
    assert.deepEqual(await readdir(root), []);
    const paths = resolveGoalProgressSessionPaths(
      resolveGoalProgressPaths({ root }),
      claudeSessionKey("one"),
    );
    await mkdir(paths.directory, { recursive: true });
    const contract = GoalContractSchema.parse({
      schemaVersion: 2,
      contractId: "gp_task0001",
      sessionId: claudeSessionKey("one"),
      sessionTreeId: claudeSessionKey("one"),
      threadId: claudeSessionKey("one"),
      nativeGoal: null,
      nativeGoalBinding: null,
      task: { objective: "Investigate", currentStep: "Inspect logs\u001b" },
      phase: "active",
      revision: 1,
      scopeRevision: 0,
      source: "model-generated",
      objectives: [],
      createdAt: "2026-09-09T00:00:00.000Z",
      updatedAt: "2026-09-09T00:00:00.000Z",
    });
    const snapshot = JSON.stringify({
      schemaVersion: 2,
      sessionId: contract.sessionId,
      revision: 1,
      contract,
    });
    await writeFile(paths.snapshotPath, snapshot);
    const output = await renderClaudeStatusLine({ session_id: "one" }, root);
    assert.match(output, /exploring/);
    assert.doesNotMatch(output, /%/);
    assert.equal(output.includes(String.fromCharCode(27)), false);
    assert.equal(await renderClaudeStatusLine({ session_id: "two" }, root), "");
    assert.equal(await readFile(paths.snapshotPath, "utf8"), snapshot);
    contract.objectives = [
      {
        id: "C1",
        title: "Delivered",
        requirement: "required",
        contributionBps: 10000,
        contributionReason: "Only result",
        status: "completed",
        evidence: [],
        items: [],
      },
    ];
    await writeFile(
      paths.snapshotPath,
      JSON.stringify({ schemaVersion: 2, sessionId: contract.sessionId, revision: 1, contract }),
    );
    assert.match(await renderClaudeStatusLine({ session_id: "one" }, root), /95%/);
    await writeFile(paths.snapshotPath, "broken");
    assert.equal(await renderClaudeStatusLine({ session_id: "one" }, root), "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
