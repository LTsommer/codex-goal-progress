import assert from "node:assert/strict";
import test from "node:test";
import {
  type GoalContract,
  GoalContractInitializationSchema,
  GoalContractSchema,
  GoalContractV1Schema,
  type GoalEvidence,
  type GoalProgressCommand,
  GoalProgressCommandSchema,
  GoalProgressEventSchema,
} from "../packages/contracts/src/index.js";
import {
  applyGoalProgressCommand,
  calculateGoalProgress,
  projectGoalProgressViewModel,
  reduceGoalProgressEvent,
} from "../packages/core/src/index.js";

const at = "2026-09-09T00:00:00.000Z";
const objective = {
  id: "C1",
  title: "Deliver result",
  requirement: "required",
  contributionBps: 10000,
  contributionReason: "Only required result",
  status: "pending",
  evidence: [],
  items: [],
};
const evidence: GoalEvidence = {
  id: "final-check",
  kind: "test",
  verification: "verified",
  summary: "Acceptance checks passed",
  observedAt: at,
  source: "local-validator",
};
function task(): GoalContract {
  return GoalContractSchema.parse({
    schemaVersion: 2,
    contractId: "gp_task0001",
    sessionId: "thread1",
    sessionTreeId: "tree1",
    threadId: "thread1",
    nativeGoal: null,
    nativeGoalBinding: null,
    task: { objective: "Investigate and deliver" },
    phase: "active",
    revision: 1,
    scopeRevision: 0,
    source: "model-generated",
    objectives: [],
    createdAt: at,
    updatedAt: at,
  });
}
function command(contract: GoalContract, payload: object): GoalProgressCommand {
  return {
    contractId: contract.contractId,
    sessionId: contract.sessionId,
    expectedRevision: contract.revision,
    eventId: `event-${contract.revision}`,
    requestId: `request-${contract.revision}`,
    turnId: "turn1",
    occurredAt: at,
    source: "model",
    ...payload,
  } as GoalProgressCommand;
}
function applyAndReplay(contract: GoalContract, payload: object): GoalContract {
  const result = applyGoalProgressCommand(contract, command(contract, payload));
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error(result.message);
  const replay = reduceGoalProgressEvent(contract, JSON.parse(JSON.stringify(result.event)));
  assert.equal(replay.ok, true, JSON.stringify(replay));
  if (!replay.ok) throw new Error(replay.message);
  assert.deepEqual(replay.contract, result.contract);
  return result.contract as GoalContract;
}

test("task exploration has no denominator and never exposes native token usage", () => {
  const result = projectGoalProgressViewModel(task(), {
    tokenUsage: {
      schemaVersion: 1,
      availability: "available",
      source: "native-goal",
      threadId: "thread1",
      tokensUsed: 900,
      tokenBudget: null,
      goalUpdatedAt: 1,
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.viewModel.overallPercent, null);
  assert.equal(result.viewModel.overallProgressBps, null);
  assert.equal(result.viewModel.token, undefined);
  assert.equal(result.viewModel.task?.objective, "Investigate and deliver");
});

test("exploration, scope, checklist, and explicit final acceptance replay identically", () => {
  let state = applyAndReplay(task(), {
    type: "update-exploration",
    currentStep: "Inspect boundary",
    findings: ["Reproduced"],
    openQuestions: ["Which module?"],
  });
  state = applyAndReplay(state, {
    type: "update-exploration",
    currentStep: "Scope ready",
    findings: ["Cause identified"],
    openQuestions: [],
  });
  assert.deepEqual(state.task?.findings, ["Cause identified"]);
  assert.equal(
    applyGoalProgressCommand(
      state,
      command(state, { type: "set-phase", phase: "completed", verification: evidence }),
    ).ok,
    false,
  );
  state = applyAndReplay(state, {
    type: "rescope",
    reason: "Investigation established acceptance scope",
    objectives: [objective],
  });
  assert.equal(
    applyGoalProgressCommand(
      state,
      command(state, {
        type: "update-exploration",
        currentStep: "x",
        findings: [],
        openQuestions: [],
      }),
    ).ok,
    false,
  );
  assert.equal(
    applyGoalProgressCommand(
      state,
      command(state, { type: "set-phase", phase: "completed", verification: evidence }),
    ).ok,
    false,
  );
  state = applyAndReplay(state, {
    type: "update-items",
    changes: [{ targetId: "C1", status: "completed" }],
  });
  assert.equal(state.phase, "active");
  const pending = projectGoalProgressViewModel(state);
  assert.equal(pending.ok && pending.viewModel.overallPercent, 95);
  assert.equal(
    applyGoalProgressCommand(state, command(state, { type: "set-phase", phase: "completed" })).ok,
    false,
  );
  assert.equal(
    applyGoalProgressCommand(
      state,
      command(state, {
        type: "set-phase",
        phase: "completed",
        verification: { ...evidence, verification: "reported" },
      }),
    ).ok,
    false,
  );
  state = applyAndReplay(state, { type: "set-phase", phase: "paused" });
  state = applyAndReplay(state, { type: "set-phase", phase: "completed", verification: evidence });
  assert.deepEqual(state.task?.completionEvidence, evidence);
  const completed = projectGoalProgressViewModel(state);
  assert.equal(completed.ok && completed.viewModel.overallPercent, 100);
});

test("native Goal retains 95 percent gate, 100 percent completion, and v1 readability", () => {
  const { task: _, ...base } = task();
  const native = GoalContractSchema.parse({
    ...base,
    objectives: [{ ...objective, status: "completed" }],
    nativeGoal: { objective: "Native objective", status: "active" },
    nativeGoalBinding: { threadId: "thread1", createdAt: 1, objectiveHash: "a".repeat(64) },
  });
  const pending = calculateGoalProgress(native);
  assert.equal(pending.ok && pending.calculation.displayProgressBps, 9500);
  const complete = applyAndReplay(native, {
    type: "sync-native-goal",
    nativeGoal: { ...native.nativeGoal, status: "complete" },
  });
  assert.equal(complete.phase, "completed");
  const result = calculateGoalProgress(complete);
  assert.equal(result.ok && result.calculation.displayProgressBps, 10000);
  const {
    nativeGoalBinding: _binding,
    threadId: _thread,
    sessionTreeId: _tree,
    ...legacy
  } = native;
  const v1 = GoalContractV1Schema.parse({
    ...legacy,
    schemaVersion: 1,
    objectives: native.objectives.map(({ requirement: _requirement, ...item }) => item),
  });
  assert.equal(calculateGoalProgress(v1).ok, true);
});

test("schema rejects mixed identities and initialization acceptance injection", () => {
  const state = task();
  assert.equal(
    GoalContractSchema.safeParse({ ...state, nativeGoal: { objective: "fake", status: "active" } })
      .success,
    false,
  );
  assert.equal(GoalContractSchema.safeParse({ ...state, task: undefined }).success, false);
  assert.equal(
    GoalContractSchema.safeParse({
      ...state,
      phase: "completed",
      task: { ...state.task, completionEvidence: evidence },
    }).success,
    false,
  );
  assert.equal(
    GoalContractInitializationSchema.safeParse({
      contractId: state.contractId,
      source: state.source,
      objectives: [],
      task: { objective: "test", completionEvidence: evidence },
    }).success,
    false,
  );
  assert.equal(
    applyGoalProgressCommand(
      state,
      command(state, {
        type: "sync-native-goal",
        nativeGoal: { objective: "fake", status: "active" },
      }),
    ).ok,
    false,
  );
});

test("replacement preserves lifecycle boundaries and detached fact in replay", () => {
  const current = task();
  const replacement = GoalContractSchema.parse({ ...task(), contractId: "gp_task0002" });
  const event = {
    schemaVersion: 2,
    type: "contract.replaced",
    contractId: replacement.contractId,
    sessionId: replacement.sessionId,
    revision: 1,
    eventId: "replacement1",
    requestId: "replacement1",
    turnId: "turn1",
    occurredAt: at,
    source: "model",
    payload: {
      contract: replacement,
      previousContractId: current.contractId,
      previousRevision: current.revision,
    },
  } as const;
  assert.equal(reduceGoalProgressEvent(current, event).ok, false);
  const detached = { ...event, payload: { ...event.payload, previousDetached: true } };
  const result = reduceGoalProgressEvent(current, detached);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.contract.contractId, replacement.contractId);
});

test("resuming and adding work clears final acceptance and replays without premature completion", () => {
  let state = GoalContractSchema.parse({
    ...task(),
    objectives: [{ ...objective, status: "completed" }],
  });
  state = applyAndReplay(state, { type: "set-phase", phase: "paused" });
  state = applyAndReplay(state, { type: "set-phase", phase: "active" });
  assert.equal(state.phase, "active");
  state = applyAndReplay(state, { type: "set-phase", phase: "completed", verification: evidence });
  const complete = projectGoalProgressViewModel(state);
  assert.equal(complete.ok && complete.viewModel.overallPercent, 100);
  state = applyAndReplay(state, {
    type: "rescope",
    reason: "Additional required work",
    objectives: [objective],
  });
  assert.equal(state.task?.completionEvidence, undefined);
  assert.equal(state.phase, "active");
  const added = projectGoalProgressViewModel(state);
  assert.equal(added.ok && added.viewModel.overallPercent, 0);
  state = applyAndReplay(state, {
    type: "update-items",
    changes: [{ targetId: "C1", status: "completed" }],
  });
  const awaiting = projectGoalProgressViewModel(state);
  assert.equal(awaiting.ok && awaiting.viewModel.overallPercent, 95);
  assert.equal(state.phase, "active");
  assert.equal(
    applyGoalProgressCommand(state, command(state, { type: "set-phase", phase: "completed" })).ok,
    false,
  );
});

test("task completion diagnostics identify missing scope and acceptance evidence", () => {
  const result = GoalContractSchema.safeParse({ ...task(), phase: "completed" });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(
    result.error.issues.some(
      (issue) => issue.path.join(".") === "objectives" && issue.message.includes("checklist"),
    ),
  );
  assert.ok(
    result.error.issues.some(
      (issue) =>
        issue.path.join(".") === "task.completionEvidence" && issue.message.includes("verified"),
    ),
  );
  assert.equal(
    result.error.issues.some((issue) => issue.path[0] === "nativeGoal"),
    false,
  );
});

test("exploration replacement requires every field and only explicit empty lists clear findings", () => {
  const initial = task();
  const first = applyAndReplay(initial, {
    type: "update-exploration",
    currentStep: "Investigating",
    findings: ["Confirmed fact"],
    openQuestions: ["Unresolved question"],
  });
  const incomplete = command(first, {
    type: "update-exploration",
    currentStep: "Next investigation",
  });
  assert.equal(GoalProgressCommandSchema.safeParse(incomplete).success, false);
  assert.equal(applyGoalProgressCommand(first, incomplete).ok, false);
  assert.deepEqual(first.task?.findings, ["Confirmed fact"]);
  const valid = applyGoalProgressCommand(
    first,
    command(first, {
      type: "update-exploration",
      currentStep: "Cleared explicitly",
      findings: [],
      openQuestions: [],
    }),
  );
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.deepEqual(valid.contract.schemaVersion === 2 && valid.contract.task?.findings, []);
  const malformedEvent = { ...valid.event, payload: { currentStep: "Missing lists" } };
  assert.equal(GoalProgressEventSchema.safeParse(malformedEvent).success, false);
  const replayed = reduceGoalProgressEvent(first, JSON.parse(JSON.stringify(valid.event)));
  assert.equal(replayed.ok, true);
  if (replayed.ok) assert.deepEqual(replayed.contract, valid.contract);
});
