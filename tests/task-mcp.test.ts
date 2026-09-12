import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GOAL_PROGRESS_TOOL_MATCHER, handleHookInput } from "../hooks/src/index.js";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import { RendererTargetManager } from "../packages/host/src/renderer-target-manager.js";
import { GoalProgressIpcClient } from "../packages/ipc/src/index.js";
import {
  createGoalProgressMcpServer,
  GoalProgressToolOutputSchema,
} from "../packages/mcp/src/index.js";
import { resolveGoalProgressPaths } from "../packages/store/src/index.js";

for (const uiUnavailable of [
  false,
  true,
  "pending",
  "pending-target",
  "pending-clear",
  "pending-publish",
]) {
  test(`MCP → socket → Helper → persisted task completes with UI unavailable=${uiUnavailable}`, {
    timeout: 3000,
  }, async () => {
    const root = await mkdtemp("/tmp/gp-mcp-");
    const paths = resolveGoalProgressPaths({ root });
    let nativeReads = 0;
    let connectionAttempts = 0;
    let publishAttempts = 0;
    let disconnectAfterInitialization = false;
    const disconnectedRenderer = new RendererTargetManager({
      connector: async () => {
        connectionAttempts++;
        if (uiUnavailable === "pending") return new Promise<never>(() => {});
        if (
          uiUnavailable === "pending-target" ||
          uiUnavailable === "pending-clear" ||
          uiUnavailable === "pending-publish"
        )
          return {
            initialTargets: [{ targetId: "target", type: "page", url: "app://-/index.html" }],
            onTargetInfo: () => () => {},
            onTargetDestroyed: () => () => {},
            close: async () => {},
            connectTarget: async () => {
              if (uiUnavailable === "pending-target") return new Promise<never>(() => {});
              return {
                clear: async () => {
                  if (uiUnavailable === "pending-clear") return new Promise<never>(() => {});
                },
                close: async () => {},
                recoverVisibleThreadId: async () => "task-thread",
                publish: async () => {
                  publishAttempts++;
                  if (disconnectAfterInitialization) return new Promise<never>(() => {});
                },
              };
            },
          };
        throw new Error("GOAL_PROGRESS_CDP_PROCESS_LOOKUP_FAILED");
      },
      sourceReconnectDelaysMs: [],
    });
    const helper = new GoalProgressHelper({
      paths,
      resolveNativeGoal: async () => {
        nativeReads++;
        throw new Error("Unexpected Goal access");
      },
      readThreadIdentity: async (id) => ({
        id,
        sessionId: id,
        cwd: "/tmp",
        threadSource: "user",
        agentRole: null,
        ephemeral: false,
      }),
      visibleThreadRecoveryDelaysMs: [],
      viewModelSink: uiUnavailable
        ? disconnectedRenderer
        : { clear: async () => {}, publish: async () => {} },
    });
    const ipcClient = new GoalProgressIpcClient(paths.helperSocketPath, { clientKind: "mcp" });
    const server = createGoalProgressMcpServer({ ipcClient });
    const client = new Client({ name: "acceptance", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    let turn = "turn-1";
    const call = async (name: string, args: Record<string, unknown>, id = randomUUID()) => {
      const response = await client.callTool({
        name,
        arguments: args,
        _meta: {
          threadId: "task-thread",
          callId: id,
          "x-codex-turn-metadata": {
            session_id: "task-thread",
            thread_id: "task-thread",
            turn_id: turn,
            model: "acceptance",
            thread_source: "user",
            cwd: "/tmp",
          },
        },
      });
      assert.ok(
        response.structuredContent,
        `Missing structured output: ${JSON.stringify(response)}`,
      );
      return GoalProgressToolOutputSchema.parse(response.structuredContent);
    };
    try {
      await helper.start();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === "goal_progress_explore"));
      assert.equal((await call("goal_progress_get", {})).code, "NOT_INITIALIZED");
      assert.equal(
        (await call("goal_progress_activate", { mode: "task" })).code,
        "TASK_INITIALIZE",
      );
      const initialized = await call("goal_progress_initialize", {
        source: "model-generated",
        objectives: [],
        task: {
          objective: "Understand the issue",
          currentStep: "Inspect the caller",
          findings: [],
          openQuestions: ["Which module owns this?"],
        },
      });
      assert.equal(initialized.ok, true, JSON.stringify(initialized));
      assert.equal(initialized.overallPercent, null);
      assert.equal(initialized.task, undefined, "Writes stay compact");
      if (uiUnavailable === "pending-publish") {
        while (publishAttempts === 0) await new Promise((resolve) => setImmediate(resolve));
        disconnectAfterInitialization = true;
      }
      const contractId = initialized.contractId;
      const explored = await call("goal_progress_explore", {
        contractId,
        expectedRevision: 1,
        currentStep: "Confirm acceptance",
        findings: ["The caller owns this behavior"],
        openQuestions: [],
      });
      assert.equal(explored.ok, true, JSON.stringify(explored));
      if (uiUnavailable === "pending-publish") {
        while (publishAttempts < 2) await new Promise((resolve) => setImmediate(resolve));
      }
      const incompleteExploration = await call("goal_progress_explore", {
        contractId,
        expectedRevision: 2,
        currentStep: "Accidentally incomplete update",
      });
      assert.equal(incompleteExploration.ok, false);
      turn = "turn-2";
      const restored = await call("goal_progress_get", {});
      assert.equal(restored.task.currentStep, "Confirm acceptance");
      assert.deepEqual(restored.task.findings, ["The caller owns this behavior"]);
      assert.deepEqual(restored.checklist, []);
      const objective = {
        id: "C1",
        title: "Investigation conclusion delivered",
        requirement: "required",
        contributionBps: 10000,
        contributionReason: "Complete agreed scope",
        status: "pending",
        evidence: [],
        items: [],
      };
      const scoped = await call("goal_progress_rescope", {
        contractId,
        expectedRevision: 2,
        reason: "当前方向：Deliver the investigation conclusion",
        objectives: [objective],
      });
      assert.equal(scoped.ok, true, JSON.stringify(scoped));
      assert.equal(scoped.overallPercent, 0);
      const finalEvidence = {
        id: "acceptance",
        kind: "manual",
        verification: "verified",
        summary: "Delivered conclusion matches observed caller behavior",
        reference: "caller.ts:10",
        observedAt: new Date().toISOString(),
        source: "model",
      };
      const updated = await call("goal_progress_update", {
        contractId,
        expectedRevision: 3,
        changes: [{ targetId: "C1", status: "completed", evidence: [finalEvidence] }],
      });
      assert.equal(updated.ok, true, JSON.stringify(updated));
      assert.equal(updated.overallPercent, 95);
      assert.ok(
        updated.nextStep.includes("verification") || updated.nextStep.includes("acceptance"),
      );
      const missing = await call("goal_progress_set_phase", {
        contractId,
        expectedRevision: 4,
        phase: "completed",
      });
      assert.equal(missing.ok, false);
      const final = await call("goal_progress_set_phase", {
        contractId,
        expectedRevision: 4,
        phase: "completed",
        verification: finalEvidence,
      });
      assert.equal(final.ok, true, JSON.stringify(final));
      assert.equal(final.overallPercent, 100);
      const saved = await call("goal_progress_get", {});
      assert.equal(saved.checklist[0].id, "C1");
      assert.equal(saved.task.completionEvidence.summary, finalEvidence.summary);
      assert.equal(nativeReads, 0);
      if (uiUnavailable) {
        assert.ok(connectionAttempts > 0, "Exercise the real renderer connection failure");
        if (uiUnavailable === true || uiUnavailable === "pending")
          assert.deepEqual(disconnectedRenderer.targetIds(), []);
      }
    } finally {
      await client.close();
      await server.close();
      await helper.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("exploration Hook is scoped and restoration never grants more execution", async () => {
  assert.equal(GOAL_PROGRESS_TOOL_MATCHER.test("goal_progress_explore"), true);
  assert.equal(GOAL_PROGRESS_TOOL_MATCHER.test("some_other_explore"), false);
  const result = await handleHookInput(
    {
      hook_event_name: "SessionStart",
      source: "resume",
      session_id: "thread",
      cwd: "/tmp",
      model: "test",
    },
    {
      resumeSession: async () => ({ status: "active", contractId: "gp_task", revision: 1 }),
    },
  );
  assert.ok(result && "additionalContext" in result.hookSpecificOutput);
  assert.match(result.hookSpecificOutput.additionalContext, /does not authorize further execution/);
});
