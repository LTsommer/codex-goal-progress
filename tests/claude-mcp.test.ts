import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { handleClaudeHook } from "../packages/claude-code/src/hooks.js";
import { createClaudeMcpServer } from "../packages/claude-code/src/mcp.js";
import { claudeSessionKey } from "../packages/claude-code/src/paths.js";
import { renderClaudeStatusLine } from "../packages/claude-code/src/statusline.js";
import {
  acquireHelperInstanceLock,
  GoalEventStore,
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
} from "../packages/store/src/index.js";

const hookResult = z.object({
  hookSpecificOutput: z.object({ updatedInput: z.record(z.string(), z.unknown()) }),
});
const output = z
  .object({
    ok: z.boolean(),
    code: z.string(),
    contractId: z.string().nullable().optional(),
    revision: z.number().nullable().optional(),
    overallPercent: z.number().nullable().optional(),
    phase: z.string().optional(),
    task: z.record(z.string(), z.unknown()).optional(),
    checklist: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();
async function connect(data: string, session = "session-a") {
  const server = createClaudeMcpServer(data);
  const client = new Client({ name: "claude-acceptance", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return {
    client,
    async call(
      name: string,
      args: Record<string, unknown>,
      sessionId = session,
      toolUseId = randomUUID(),
    ) {
      const signed = hookResult.parse(
        await handleClaudeHook(
          {
            hook_event_name: "PreToolUse",
            session_id: sessionId,
            cwd: "/tmp/project",
            prompt_id: "prompt-a",
            tool_use_id: toolUseId,
            tool_name: `mcp__plugin_goal-progress_goal_progress__${name}`,
            tool_input: args,
          },
          data,
        ),
      );
      const response = await client.callTool({
        name,
        arguments: signed.hookSpecificOutput.updatedInput,
      });
      return output.parse(response.structuredContent);
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}
const initialization = {
  source: "model-generated",
  task: { objective: "Deliver a verified importer", currentStep: "Identify acceptance outcomes" },
  objectives: [],
};
const objective = {
  id: "C1",
  title: "Importer result is correct",
  requirement: "required",
  contributionBps: 10000,
  contributionReason: "Entire agreed outcome",
  status: "pending",
  items: [],
  evidence: [],
};

test("real Claude Hook → MCP → Store lifecycle, recovery, identity rejection and read-only status line", async () => {
  const data = await mkdtemp("/tmp/gp-claude-mcp-");
  let connection = await connect(data);
  const paths = resolveGoalProgressPaths({ root: data });
  const session = resolveGoalProgressSessionPaths(paths, claudeSessionKey("session-a"));
  try {
    const noProof = await connection.client.callTool({
      name: "goal_progress_activate",
      arguments: {},
    });
    assert.equal(noProof.isError, true);
    const plan = await connection.call("goal_progress_activate", {});
    assert.equal(plan.code, "TASK_INITIALIZE");
    const callId = randomUUID();
    const first = await connection.call(
      "goal_progress_initialize",
      initialization,
      "session-a",
      callId,
    );
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.overallPercent, null);
    assert.equal(
      (await connection.call("goal_progress_initialize", initialization, "session-a", callId))
        .duplicate,
      true,
    );
    assert.equal(
      (
        await connection.call("goal_progress_initialize", {
          ...initialization,
          task: { objective: "Overwrite silently" },
        })
      ).code,
      "TRACKING_ALREADY_ACTIVE",
    );
    const id = first.contractId;
    assert.ok(id);
    const exploration = await connection.call("goal_progress_explore", {
      contractId: id,
      expectedRevision: 1,
      currentStep: "Define acceptance",
      findings: ["Input contract located"],
      openQuestions: [],
    });
    assert.equal(exploration.revision, 2);
    assert.equal((await connection.call("goal_progress_get", {}, "session-b")).ok, false);
    await connection.close();
    connection = await connect(data);
    const resumed = await connection.call("goal_progress_get", {});
    assert.equal(resumed.task?.currentStep, "Define acceptance");
    const scoped = await connection.call("goal_progress_rescope", {
      contractId: id,
      expectedRevision: 2,
      reason: "当前方向：Deliver verified importer",
      objectives: [objective],
    });
    assert.equal(scoped.overallPercent, 0);
    const evidence = {
      id: "acceptance-1",
      kind: "test",
      verification: "verified",
      summary: "Importer acceptance suite passed",
      source: "local-validator",
      observedAt: new Date().toISOString(),
    };
    const done = await connection.call("goal_progress_update", {
      contractId: id,
      expectedRevision: 3,
      changes: [{ targetId: "C1", status: "completed", evidence: [evidence] }],
    });
    assert.equal(done.overallPercent, 95);
    assert.equal(
      (
        await connection.call("goal_progress_set_phase", {
          contractId: id,
          expectedRevision: 4,
          phase: "completed",
        })
      ).ok,
      false,
    );
    const final = await connection.call("goal_progress_set_phase", {
      contractId: id,
      expectedRevision: 4,
      phase: "completed",
      verification: evidence,
    });
    assert.equal(final.overallPercent, 100);
    const saved = await new GoalEventStore(paths).load(claudeSessionKey("session-a"));
    assert.equal(saved.contract?.nativeGoal, null);
    assert.equal(saved.contract?.objectives[0]?.evidence[0]?.verification, "reported");
    assert.equal(saved.contract?.task?.completionEvidence?.source, "model");
    const before = await readFile(session.eventsPath);
    assert.match(await renderClaudeStatusLine({ session_id: "session-a" }, data), /100%/);
    assert.equal(await renderClaudeStatusLine({ session_id: "session-b" }, data), "");
    assert.deepEqual(await readFile(session.eventsPath), before);
    const next = await connection.call("goal_progress_initialize", {
      ...initialization,
      task: { objective: "Next explicitly requested outcome" },
    });
    assert.equal(next.ok, true, JSON.stringify(next));
    assert.notEqual(next.contractId, id);
  } finally {
    await connection.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("another live writer prevents Claude updates and leaves committed events unchanged", async () => {
  const data = await mkdtemp("/tmp/gp-claude-lock-");
  const connection = await connect(data);
  try {
    const first = await connection.call("goal_progress_initialize", initialization);
    const roots = await readdir(join(data, "writers"));
    assert.equal(roots.length, 1);
    const holder = await acquireHelperInstanceLock(
      resolveGoalProgressPaths({ root: join(data, "writers", roots[0] ?? "") }),
    );
    const eventsPath = resolveGoalProgressSessionPaths(
      resolveGoalProgressPaths({ root: data }),
      claudeSessionKey("session-a"),
    ).eventsPath;
    const before = await readFile(eventsPath);
    try {
      const blocked = await connection.call("goal_progress_explore", {
        contractId: first.contractId,
        expectedRevision: 1,
        currentStep: "Must not commit",
        findings: [],
        openQuestions: [],
      });
      assert.equal(blocked.code, "CLAUDE_SESSION_BUSY");
      assert.deepEqual(await readFile(eventsPath), before);
    } finally {
      await holder.release();
    }
    const after = await connection.call("goal_progress_explore", {
      contractId: first.contractId,
      expectedRevision: 1,
      currentStep: "Allowed after release",
      findings: [],
      openQuestions: [],
    });
    assert.equal(after.revision, 2);
  } finally {
    await connection.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("packaged Claude stdio entry starts and accepts a real Hook proof without Codex", async () => {
  const data = await mkdtemp("/tmp/gp-claude-bundle-");
  const client = new Client({ name: "claude-bundle-check", version: "1" });
  const plugin = join(process.cwd(), "dist/claude-marketplace/plugins/goal-progress");
  try {
    await client.connect(
      new StdioClientTransport({
        command: join(plugin, "bin/goal-progress"),
        args: ["mcp"],
        env: {
          ...process.env,
          GOAL_PROGRESS_CLAUDE_DATA: data,
          GOAL_PROGRESS_CODEX_COMMAND: "/must-not-start-codex",
        },
        stderr: "pipe",
      }),
    );
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 7);
    const signed = hookResult.parse(
      JSON.parse(
        execFileSync(join(plugin, "bin/goal-progress"), ["hook"], {
          encoding: "utf8",
          env: { ...process.env, GOAL_PROGRESS_CLAUDE_DATA: data },
          input: JSON.stringify({
            hook_event_name: "PreToolUse",
            session_id: "bundle-session",
            cwd: "/tmp/project",
            tool_use_id: randomUUID(),
            tool_name: "mcp__plugin_goal-progress_goal_progress__goal_progress_initialize",
            tool_input: initialization,
          }),
        }),
      ),
    );
    const result = await client.callTool({
      name: "goal_progress_initialize",
      arguments: signed.hookSpecificOutput.updatedInput,
    });
    const parsed = output.parse(result.structuredContent);
    assert.equal(parsed.ok, true, JSON.stringify(parsed));
    assert.equal(parsed.overallPercent, null);
    const status = execFileSync(join(plugin, "bin/goal-progress"), ["statusline"], {
      encoding: "utf8",
      env: { ...process.env, GOAL_PROGRESS_CLAUDE_DATA: data },
      input: JSON.stringify({ session_id: "bundle-session" }),
    });
    assert.match(status, /Goal Progress.*exploring/);
  } finally {
    await client.close();
    await rm(data, { recursive: true, force: true });
  }
});
