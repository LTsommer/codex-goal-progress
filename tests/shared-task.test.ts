import assert from "node:assert/strict";
import test from "node:test";
import {
  GoalContractInitializationSchema,
  type GoalEvidence,
  type RuntimeIdentity,
} from "../packages/contracts/src/index.js";
import {
  createTaskContract,
  sanitizeModelCommand,
  sanitizeModelObjective,
  TaskRecoveryError,
  taskRecoveryPage,
} from "../packages/core/src/index.js";
import { createModelContract } from "../packages/host/src/helper-session-coordinator.js";
import { taskRecoveryPage as hostRecoveryPage } from "../packages/host/src/task-recovery.js";
import { GoalProgressIpcHandlerError } from "../packages/ipc/src/index.js";

const at = "2026-09-09T00:00:00.000Z";
const evidence: GoalEvidence = {
  id: "check",
  kind: "test",
  verification: "verified",
  summary: "Actual check",
  observedAt: at,
  source: "local-validator",
};
const input = () =>
  GoalContractInitializationSchema.parse({
    contractId: "gp_shared01",
    source: "model-generated",
    task: { objective: "Deliver result" },
    objectives: [
      {
        id: "C1",
        title: "Result",
        requirement: "required",
        contributionBps: 10000,
        contributionReason: "Only result",
        status: "pending",
        evidence: [evidence],
        items: [{ id: "C1.1", title: "Child", status: "pending", evidence: [evidence] }],
      },
    ],
  });
const identity = { threadId: "thread1", sessionTreeId: "tree1" };

test("ordinary task factory preserves Codex identity and sanitization contract", () => {
  const initialization = input();
  const result = createTaskContract(initialization, identity, at);
  assert.deepEqual(
    result,
    createModelContract(initialization, null, identity as RuntimeIdentity, at),
  );
  assert.equal(result.nativeGoal, null);
  assert.equal(result.nativeGoalBinding, null);
  assert.equal(result.sessionId, identity.threadId);
  assert.equal(result.revision, 1);
  assert.equal(result.phase, "active");
  assert.equal(result.objectives[0].evidence[0].verification, "reported");
  assert.equal(result.objectives[0].items[0].evidence[0].source, "model");
  assert.equal(initialization.objectives[0].evidence[0].verification, "verified");
  assert.throws(
    () => createTaskContract({ ...initialization, task: undefined }, identity, at),
    /TASK_REQUIRED/,
  );
});

test("rescope retains real stored evidence only for unchanged results", () => {
  const prior = input().objectives[0];
  const incoming = structuredClone(prior);
  incoming.evidence = [];
  incoming.items[0].evidence = [];
  const reused = sanitizeModelObjective(incoming, prior);
  assert.deepEqual(reused.evidence, [evidence]);
  assert.deepEqual(reused.items[0].evidence, [evidence]);
  incoming.items[0].title = "Changed outcome";
  incoming.items[0].evidence = [evidence];
  const changed = sanitizeModelObjective(incoming, prior);
  assert.deepEqual(changed.evidence, []);
  assert.equal(changed.items[0].evidence[0].verification, "reported");
  assert.equal(changed.items[0].evidence[0].source, "model");
});

test("shared command policy demotes model item evidence but preserves explicit final verification", () => {
  const contract = createTaskContract(input(), identity, at);
  const base = {
    contractId: contract.contractId,
    sessionId: contract.sessionId,
    expectedRevision: 1,
    eventId: "e1",
    requestId: "r1",
    turnId: "t1",
    occurredAt: at,
    source: "local-validator" as const,
  };
  const update = sanitizeModelCommand({
    ...base,
    type: "update-items",
    changes: [{ targetId: "C1", status: "completed", evidence: [evidence] }],
  });
  assert.equal(update.source, "model");
  assert.equal(
    update.type === "update-items" && update.changes[0].evidence?.[0].verification,
    "reported",
  );
  const finish = sanitizeModelCommand({
    ...base,
    type: "set-phase",
    phase: "completed",
    verification: evidence,
  });
  assert.equal(finish.type === "set-phase" && finish.verification?.verification, "verified");
  assert.equal(finish.type === "set-phase" && finish.verification?.source, "model");
});

test("shared recovery pages retain host error codes and revision behavior", () => {
  const contract = createTaskContract(input(), identity, at);
  assert.deepEqual(taskRecoveryPage(contract), hostRecoveryPage(contract));
  for (const [cursor, code] of [
    ["bad", "INVALID_COMMAND"],
    ["0:0", "REVISION_CONFLICT"],
    ["1:999", "INVALID_COMMAND"],
  ]) {
    assert.throws(
      () => taskRecoveryPage(contract, cursor),
      (e: unknown) => e instanceof TaskRecoveryError && e.code === code && e.currentRevision === 1,
    );
    assert.throws(
      () => hostRecoveryPage(contract, cursor),
      (e: unknown) => e instanceof GoalProgressIpcHandlerError && e.code === code,
    );
  }
});
