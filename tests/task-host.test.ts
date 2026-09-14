import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { createModelContract } from "../packages/host/src/helper-session-coordinator.js";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import {
  GoalEventStore,
  readGoalProgressUiPreference,
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
} from "../packages/store/src/index.js";

// Exercise the real socket, authorization boundary, Helper, event store and reducer.
test("ordinary task survives turns and restart without consulting native Goal", async () => {
  const root = await mkdtemp("/tmp/gp-task-");
  const paths = resolveGoalProgressPaths({ root });
  let nativeReads = 0;
  const makeHelper = () =>
    new GoalProgressHelper({
      paths,
      runtime: {
        getGoal: async () => {
          nativeReads++;
          throw new Error("Task must not read Goal");
        },
        refreshGoalUsage: async () => {
          nativeReads++;
          throw new Error("Task must not refresh Goal tokens");
        },
        watchGoalUsage: () => {
          nativeReads++;
          throw new Error("Task must not watch Goal tokens");
        },
        unwatchGoalUsage: () => {},
        setPollingMode: () => {},
        readThreadIdentity: async () => {
          throw new Error("Use injected identity reader");
        },
        resolveCurrentThread: async () => {
          throw new Error("Use injected thread resolver");
        },
        close: async () => {},
      },
      readThreadIdentity: async (id) => ({
        id,
        sessionId: "session-a",
        cwd: "/tmp",
        threadSource: "user",
        agentRole: null,
        ephemeral: false,
      }),
      resolveCurrentThread: async ({ sessionTreeId }) => ({
        threadId: sessionTreeId,
        sessionTreeId,
        turnId: "turn-2",
        cwd: "/tmp",
        model: "test",
      }),
      visibleThreadRecoveryDelaysMs: [],
      viewModelSink: { clear: async () => {}, publish: async () => {} },
    });
  let helper = makeHelper();
  const client = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "mcp" });
  const auth = (toolName: string, threadId = "thread-a", turnId = "turn-1") => ({
    kind: "codex-request" as const,
    toolName,
    identity: {
      threadId,
      sessionId: "session-a",
      turnId,
      callId: randomUUID(),
      model: "test",
      threadSource: "user" as const,
      cwd: "/tmp",
    },
  });
  const metadata = () => ({
    eventId: randomUUID(),
    requestId: randomUUID(),
    turnId: "turn-1",
    occurredAt: new Date().toISOString(),
    source: "model" as const,
  });
  const initialization = {
    contractId: "gp_task0001",
    source: "model-generated" as const,
    objectives: [],
    task: {
      objective: "Investigate scope",
      currentStep: "Read entry points",
      findings: [],
      openQuestions: ["How broad is the change?"],
    },
  };
  try {
    await helper.start();
    const empty = await client.request({
      method: "store.load",
      params: { sessionId: "thread-a", auth: auth("goal_progress_get") },
    });
    assert.equal(empty.result.viewModel, null);
    const planned = await client.request({
      method: "activation.plan",
      params: { mode: "task", auth: auth("goal_progress_activate") },
    });
    assert.equal(planned.result.code, "TASK_INITIALIZE");
    const initMetadata = metadata();
    await client.request({
      method: "store.initialize",
      params: { initialization, metadata: initMetadata, auth: auth("goal_progress_initialize") },
    });
    const duplicate = await client.request({
      method: "store.initialize",
      params: { initialization, metadata: initMetadata, auth: auth("goal_progress_initialize") },
    });
    assert.equal(duplicate.result.duplicate, true);
    await client.request({
      method: "store.apply",
      params: {
        auth: auth("goal_progress_explore"),
        command: {
          ...metadata(),
          contractId: initialization.contractId,
          sessionId: "thread-a",
          expectedRevision: 1,
          type: "update-exploration",
          currentStep: "Check caller",
          findings: ["Entry point located"],
          openQuestions: ["Who owns final validation?"],
        },
      },
    });
    await assert.rejects(
      client.request({
        method: "store.load",
        params: { sessionId: "thread-b", auth: auth("goal_progress_get") },
      }),
      { code: "THREAD_MISMATCH" },
    );
    await assert.rejects(
      client.request({
        method: "store.initialize",
        params: {
          initialization: { ...initialization, contractId: "gp_task0002" },
          metadata: metadata(),
          auth: auth("goal_progress_initialize"),
        },
      }),
      { code: "TRACKING_ALREADY_ACTIVE" },
    );
    await helper.stop();
    helper = makeHelper();
    await helper.start();
    const resumed = await client.request({
      method: "store.load",
      params: { sessionId: "thread-a", auth: auth("goal_progress_get", "thread-a", "turn-2") },
    });
    assert.equal(resumed.result.viewModel.task.currentStep, "Check caller");
    assert.deepEqual(resumed.result.checklist, []);
    const stored = (await new GoalEventStore(paths).load("thread-a")).contract;
    assert.equal(stored?.nativeGoal, null);
    assert.equal(stored?.nativeGoalBinding, null);
    assert.equal(nativeReads, 0);
    const hook = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "hook" });
    const resumedHook = await hook.request({
      method: "activation.resume",
      params: { hookSessionId: "thread-a", model: "test", cwd: "/tmp" },
    });
    assert.equal(resumedHook.result.status, "active");
    assert.equal(nativeReads, 0);
    const cdp = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "cdp" });
    const accentChanged = await cdp.request({
      method: "ui.intent",
      params: { sessionId: "thread-a", intent: { type: "setAccent", accent: "rainbow" } },
    });
    assert.equal(accentChanged.result.uiPreference.accent, "rainbow");
    assert.equal((await readGoalProgressUiPreference(paths)).accent, "rainbow");
    await cdp.request({
      method: "ui.intent",
      params: { sessionId: "thread-a", intent: { type: "requestDetach" } },
    });
    const detached = await hook.request({
      method: "activation.resume",
      params: { hookSessionId: "thread-a", model: "test", cwd: "/tmp" },
    });
    assert.equal(detached.result.status, "inactive");
    await client.request({
      method: "store.initialize",
      params: {
        initialization: { ...initialization, contractId: "gp_task0002" },
        metadata: metadata(),
        auth: auth("goal_progress_initialize"),
      },
    });
    assert.equal(
      (await new GoalEventStore(paths).load("thread-a")).contract?.contractId,
      "gp_task0002",
    );
    const evidence = {
      id: "validation-1",
      kind: "test",
      verification: "verified",
      summary: "Acceptance check passed",
      observedAt: new Date().toISOString(),
      source: "local-validator",
    };
    await client.request({
      method: "store.apply",
      params: {
        auth: auth("goal_progress_rescope"),
        command: {
          ...metadata(),
          contractId: "gp_task0002",
          sessionId: "thread-a",
          expectedRevision: 1,
          type: "rescope",
          reason: "Scope confirmed",
          objectives: [
            {
              id: "C1",
              title: "Acceptance result",
              requirement: "required",
              contributionBps: 10000,
              contributionReason: "Entire scope",
              status: "completed",
              evidence: [evidence],
              items: [],
            },
          ],
        },
      },
    });
    await assert.rejects(
      client.request({
        method: "store.apply",
        params: {
          auth: auth("goal_progress_set_phase"),
          command: {
            ...metadata(),
            contractId: "gp_task0002",
            sessionId: "thread-a",
            expectedRevision: 2,
            type: "set-phase",
            phase: "completed",
          },
        },
      }),
      { code: "INVALID_TRANSITION" },
    );
    const complete = await client.request({
      method: "store.apply",
      params: {
        auth: auth("goal_progress_set_phase"),
        command: {
          ...metadata(),
          contractId: "gp_task0002",
          sessionId: "thread-a",
          expectedRevision: 2,
          type: "set-phase",
          phase: "completed",
          verification: evidence,
        },
      },
    });
    assert.equal(complete.result.viewModel.trackingPhase, "completed");
    const completedContract = (await new GoalEventStore(paths).load("thread-a")).contract;
    assert.equal(completedContract?.task?.completionEvidence?.source, "model");
    assert.equal(completedContract?.objectives[0].evidence[0].verification, "reported");
    const thirdMetadata = metadata();
    const third = { ...initialization, contractId: "gp_task0003" };
    await client.request({
      method: "store.initialize",
      params: {
        initialization: third,
        metadata: thirdMetadata,
        auth: auth("goal_progress_initialize"),
      },
    });
    const thirdRetry = await client.request({
      method: "store.initialize",
      params: {
        initialization: third,
        metadata: thirdMetadata,
        auth: auth("goal_progress_initialize"),
      },
    });
    assert.equal(thirdRetry.result.duplicate, true);
    assert.equal(
      (await new GoalEventStore(paths).load("thread-a")).contract?.contractId,
      third.contractId,
    );
    assert.equal(nativeReads, 0);
  } finally {
    await helper.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("native activation remains explicit and an active native record cannot be overwritten by a task", async () => {
  const root = await mkdtemp("/tmp/gp-native-");
  const paths = resolveGoalProgressPaths({ root });
  let nativeGoal: null | {
    threadId: string;
    objective: string;
    status: "active";
    createdAt: number;
  } = null;
  const helper = new GoalProgressHelper({
    paths,
    resolveNativeGoal: async () => nativeGoal,
    readThreadIdentity: async (id) => ({
      id,
      sessionId: "session-a",
      cwd: "/tmp",
      threadSource: "user",
      agentRole: null,
      ephemeral: false,
    }),
    visibleThreadRecoveryDelaysMs: [],
    viewModelSink: { clear: async () => {}, publish: async () => {} },
  });
  const client = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "mcp" });
  const auth = (toolName: string) => ({
    kind: "codex-request" as const,
    toolName,
    identity: {
      threadId: "thread-a",
      sessionId: "session-a",
      turnId: "turn-1",
      callId: randomUUID(),
      model: "test",
      threadSource: "user" as const,
      cwd: "/tmp",
    },
  });
  const metadata = () => ({
    eventId: randomUUID(),
    requestId: randomUUID(),
    turnId: "turn-1",
    occurredAt: new Date().toISOString(),
    source: "model" as const,
  });
  try {
    await helper.start();
    const missing = await client.request({
      method: "activation.plan",
      params: { auth: auth("goal_progress_activate") },
    });
    assert.equal(missing.result.code, "NATIVE_GOAL_REQUIRED");
    assert.equal((await new GoalEventStore(paths).load("thread-a")).contract, null);
    nativeGoal = {
      threadId: "thread-a",
      objective: "Original Goal",
      status: "active",
      createdAt: 123,
    };
    const planned = await client.request({
      method: "activation.plan",
      params: { auth: auth("goal_progress_activate") },
    });
    assert.equal(planned.result.code, "ACTIVATION_INITIALIZE");
    await client.request({
      method: "store.initialize",
      params: {
        auth: auth("goal_progress_initialize"),
        metadata: metadata(),
        initialization: {
          contractId: "gp_native01",
          source: "model-generated",
          objectives: [
            {
              id: "C1",
              title: "Deliver result",
              requirement: "required",
              contributionBps: 10000,
              contributionReason: "Full scope",
              status: "pending",
              evidence: [],
              items: [],
            },
          ],
        },
      },
    });
    await assert.rejects(
      client.request({
        method: "activation.plan",
        params: { mode: "task", auth: auth("goal_progress_activate") },
      }),
      { code: "TRACKING_ALREADY_ACTIVE" },
    );
    await assert.rejects(
      client.request({
        method: "store.initialize",
        params: {
          auth: auth("goal_progress_initialize"),
          metadata: metadata(),
          initialization: {
            contractId: "gp_task0001",
            source: "model-generated",
            objectives: [],
            task: {
              objective: "Different task",
              currentStep: "Investigate",
              findings: [],
              openQuestions: [],
            },
          },
        },
      }),
      { code: "TRACKING_ALREADY_ACTIVE" },
    );
    const stored = (await new GoalEventStore(paths).load("thread-a")).contract;
    assert.equal(stored?.contractId, "gp_native01");
    assert.equal(stored?.nativeGoal?.objective, "Original Goal");
    assert.equal(stored?.nativeGoalBinding?.createdAt, 123);
  } finally {
    await helper.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("large evidence history recovers in bounded revision-locked pages without changing stored evidence", async () => {
  const root = await mkdtemp("/tmp/gp-recovery-");
  const paths = resolveGoalProgressPaths({ root });
  const store = new GoalEventStore(paths);
  const identity = {
    threadId: "thread-a",
    sessionTreeId: "thread-a",
    turnId: "turn-1",
    model: "test",
    cwd: "/tmp",
  };
  const now = new Date().toISOString();
  const contract = createModelContract(
    {
      contractId: "gp_paging01",
      source: "model-generated",
      task: {
        objective: "Verify a large task",
        currentStep: "Validate results",
        findings: [],
        openQuestions: [],
      },
      objectives: [
        {
          id: "C1",
          title: "Verify results",
          requirement: "required",
          contributionBps: 10000,
          contributionReason: "Full scope",
          status: "pending",
          evidence: [],
          items: Array.from({ length: 44 }, (_, itemIndex) => ({
            id: `C1.${itemIndex + 1}`,
            title: `Result ${itemIndex + 1}`,
            status: "pending",
            evidence: Array.from({ length: 50 }, (_, evidenceIndex) => ({
              id: `evidence-${itemIndex}-${evidenceIndex}`,
              kind: "test",
              verification: "reported",
              summary: "s".repeat(500),
              reference: "r".repeat(1000),
              observedAt: now,
              source: "model",
            })),
          })),
        },
      ],
    },
    null,
    identity,
    now,
  );
  const helper = new GoalProgressHelper({
    paths,
    resolveNativeGoal: async () => {
      throw new Error("No native Goal for task recovery");
    },
    readThreadIdentity: async (id) => ({
      id,
      sessionId: "session-a",
      cwd: "/tmp",
      threadSource: "user",
      agentRole: null,
      ephemeral: false,
    }),
    visibleThreadRecoveryDelaysMs: [],
    viewModelSink: { clear: async () => {}, publish: async () => {} },
  });
  const client = new GoalProgressIpcClient(paths.helperSocketPath, {
    clientKind: "mcp",
    timeoutMs: 10000,
  });
  const auth = () => ({
    kind: "codex-request",
    toolName: "goal_progress_get",
    identity: {
      threadId: "thread-a",
      sessionId: "session-a",
      turnId: "turn-2",
      callId: randomUUID(),
      model: "test",
      threadSource: "user",
      cwd: "/tmp",
    },
  });
  const getPage = (cursor?: string) =>
    client.request({
      method: "store.load",
      params: { sessionId: "thread-a", auth: auth(), ...(cursor === undefined ? {} : { cursor }) },
    });
  try {
    await store.initialize(contract, {
      eventId: randomUUID(),
      requestId: randomUUID(),
      turnId: identity.turnId,
      occurredAt: now,
      source: "model",
    });
    const sessionPaths = resolveGoalProgressSessionPaths(paths, identity.threadId);
    const historyBefore = await readFile(sessionPaths.eventsPath);
    const snapshotBefore = await readFile(sessionPaths.snapshotPath);
    assert.ok(historyBefore.byteLength > 1_048_576, "fixture must exceed the IPC limit");
    await helper.start();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await getPage(cursor);
      assert.ok(Buffer.byteLength(JSON.stringify(response)) < 1_048_576);
      assert.ok(response.result.checklist.length <= 20);
      for (const entry of response.result.checklist) {
        ids.push(entry.id);
        if (entry.parentId !== null) {
          assert.equal(entry.parentId, "C1");
          assert.equal(entry.evidenceCount, 50);
          assert.equal(entry.lastEvidence.summary.length, 160);
          assert.equal(entry.lastEvidence.reference.length, 256);
          assert.equal(entry.lastEvidence.verification, "reported");
        } else {
          assert.equal(entry.requirement, "required");
          assert.equal(entry.contributionBps, 10000);
          assert.equal(entry.contributionReason, "Full scope");
        }
      }
      cursor = response.result.nextCursor ?? undefined;
    } while (cursor !== undefined);
    assert.deepEqual(ids, ["C1", ...Array.from({ length: 44 }, (_, index) => `C1.${index + 1}`)]);
    await assert.rejects(getPage("invalid"), { code: "IPC_REQUEST_INVALID" });
    await assert.rejects(getPage("1:45"), { code: "INVALID_COMMAND" });
    assert.deepEqual(await readFile(sessionPaths.eventsPath), historyBefore);
    assert.deepEqual(await readFile(sessionPaths.snapshotPath), snapshotBefore);
    const updated = await store.apply({
      type: "rescope",
      contractId: contract.contractId,
      sessionId: identity.threadId,
      expectedRevision: 1,
      eventId: randomUUID(),
      requestId: randomUUID(),
      turnId: identity.turnId,
      occurredAt: new Date().toISOString(),
      source: "model",
      reason: "Reconfirm the acceptance scope",
      objectives: contract.objectives,
    });
    assert.equal(updated.ok, true);
    const afterUpdate = await readFile(sessionPaths.eventsPath);
    await assert.rejects(getPage("1:20"), { code: "REVISION_CONFLICT", revision: 2 });
    assert.deepEqual(await readFile(sessionPaths.eventsPath), afterUpdate);
    assert.deepEqual(
      (await store.load(identity.threadId)).contract?.objectives,
      contract.objectives,
    );
  } finally {
    await helper.stop();
    await rm(root, { recursive: true, force: true });
  }
});
