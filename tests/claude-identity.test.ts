import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleClaudeHook } from "../packages/claude-code/src/hooks.js";
import { ClaudeIdentityVerifier, ClaudeProofSchema } from "../packages/claude-code/src/identity.js";
import { claudeSessionKey } from "../packages/claude-code/src/paths.js";

const tool = "mcp__plugin_goal-progress_goal_progress__goal_progress_activate";
function hook(session = "session-a") {
  return {
    hook_event_name: "PreToolUse",
    session_id: session,
    cwd: "/tmp/project",
    tool_name: tool,
    tool_use_id: "tool-1",
    tool_input: { mode: "task", _claudeProof: "forged" },
  };
}
async function proof(root: string, session?: string) {
  const output = (await handleClaudeHook(hook(session), root)) as {
    hookSpecificOutput: { updatedInput: { _claudeProof: unknown }; permissionDecision?: string };
  };
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined);
  return ClaudeProofSchema.parse(output.hookSpecificOutput.updatedInput._claudeProof);
}
test("Claude Hook output authorizes MCP, denies forgery, expiry, replay across restart and session switching", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-identity-"));
  try {
    const verifier = new ClaudeIdentityVerifier(root);
    const p = await proof(root);
    await assert.rejects(verifier.authorize(tool, { ...p, sessionId: "forged" }), /INVALID/);
    await assert.rejects(
      verifier.authorize(tool, { ...p, issuedAtMs: Date.now() - 300001 }),
      /EXPIRED/,
    );
    await assert.rejects(verifier.authorize(tool.replace("activate", "get"), p), /WRONG_TOOL/);
    assert.equal((await verifier.authorize(tool, p)).sessionId, "session-a");
    await assert.rejects(new ClaudeIdentityVerifier(root).authorize(tool, p), /REPLAY/);
    await assert.rejects(
      verifier.authorize(tool, await proof(root, "session-b")),
      /SESSION_MISMATCH/,
    );
    assert.equal((await stat(join(root, "identity", "proof.key"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(root, "identity"))).mode & 0o777, 0o700);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("Claude hooks reject missing identity and subagents; SessionStart never creates progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-hook-"));
  try {
    await assert.rejects(handleClaudeHook({}, root), /CONTEXT_REQUIRED/);
    await assert.rejects(handleClaudeHook({ ...hook(), agent_id: "child" }, root), /SUBAGENT/);
    await assert.rejects(
      handleClaudeHook({ ...hook(), tool_use_id: undefined }, root),
      /TOOL_CONTEXT_REQUIRED/,
    );
    assert.equal(
      await handleClaudeHook(
        { hook_event_name: "SessionStart", session_id: "session-a", cwd: "/tmp/project" },
        root,
      ),
      undefined,
    );
    await assert.rejects(stat(join(root, "state")), { code: "ENOENT" });
    assert.equal(
      await handleClaudeHook({ ...hook(), tool_name: "mcp__other__goal_progress_activate" }, root),
      undefined,
    );
    const proofs = await Promise.all(Array.from({ length: 8 }, () => proof(root)));
    await Promise.all(proofs.map((p) => new ClaudeIdentityVerifier(root).authorize(tool, p)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SessionStart restores only the matching active or paused task without rewriting snapshot", async () => {
  const { GoalContractSchema } = await import("../packages/contracts/src/index.js");
  const { resolveGoalProgressPaths, resolveGoalProgressSessionPaths } = await import(
    "../packages/store/src/paths.js"
  );
  const root = await mkdtemp(join(tmpdir(), "claude-restore-"));
  try {
    const sessionId = claudeSessionKey("session-a");
    const paths = resolveGoalProgressSessionPaths(resolveGoalProgressPaths({ root }), sessionId);
    await mkdir(paths.directory, { recursive: true });
    const at = new Date().toISOString();
    const contract = GoalContractSchema.parse({
      schemaVersion: 2,
      contractId: "gp_task0001",
      sessionId,
      sessionTreeId: sessionId,
      threadId: sessionId,
      nativeGoal: null,
      nativeGoalBinding: null,
      task: { objective: "Investigate" },
      phase: "paused",
      revision: 1,
      scopeRevision: 0,
      source: "model-generated",
      objectives: [],
      createdAt: at,
      updatedAt: at,
    });
    const text = JSON.stringify({ sessionId, contract });
    await writeFile(paths.snapshotPath, text);
    const input = { hook_event_name: "SessionStart", session_id: "session-a", cwd: "/tmp/project" };
    const restored = await handleClaudeHook(input, root);
    assert.match(JSON.stringify(restored), /goal_progress_get/);
    assert.equal(await readFile(paths.snapshotPath, "utf8"), text);
    assert.equal(await handleClaudeHook({ ...input, session_id: "session-b" }, root), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
