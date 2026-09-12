import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { GoalContractSchema } from "../../contracts/src/index.js";
import {
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
} from "../../store/src/paths.js";
import { ClaudeToolNameSchema, issueClaudeProof } from "./identity.js";
import { claudeSessionKey } from "./paths.js";

const HookSchema = z.object({
  hook_event_name: z.string(),
  session_id: z.string().min(1).max(256),
  cwd: z.string().refine(isAbsolute),
  agent_id: z.unknown().optional(),
  tool_name: z.string().optional(),
  tool_use_id: z.string().min(1).max(256).optional(),
  prompt_id: z.string().min(1).max(256).optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
});
export async function handleClaudeHook(
  input: unknown,
  dataRoot: string,
): Promise<object | undefined> {
  const parsed = HookSchema.safeParse(input);
  if (!parsed.success) throw new Error("CLAUDE_HOOK_CONTEXT_REQUIRED");
  const hook = parsed.data;
  if (hook.agent_id !== undefined) throw new Error("CLAUDE_SUBAGENT_NOT_SUPPORTED");
  if (hook.hook_event_name === "PreToolUse") {
    const toolName = ClaudeToolNameSchema.safeParse(hook.tool_name);
    if (!toolName.success) return undefined;
    if (!hook.tool_use_id || !hook.tool_input) throw new Error("CLAUDE_HOOK_TOOL_CONTEXT_REQUIRED");
    const proof = await issueClaudeProof(
      {
        sessionId: hook.session_id,
        cwd: hook.cwd,
        toolUseId: hook.tool_use_id,
        ...(hook.prompt_id ? { promptId: hook.prompt_id } : {}),
      },
      toolName.data,
      dataRoot,
    );
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...hook.tool_input, _claudeProof: proof },
      },
    };
  }
  if (hook.hook_event_name !== "SessionStart") return undefined;
  const sessionId = claudeSessionKey(hook.session_id);
  const paths = resolveGoalProgressSessionPaths(
    resolveGoalProgressPaths({ root: dataRoot }),
    sessionId,
  );
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(await readFile(paths.snapshotPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const envelope = z
    .object({ sessionId: z.literal(sessionId), contract: GoalContractSchema })
    .parse(snapshot);
  const contract = envelope.contract;
  if (
    contract.sessionId !== sessionId ||
    !contract.task ||
    !["active", "paused"].includes(contract.phase)
  )
    return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `Goal Progress has an existing ordinary-task record (${contract.contractId}, revision ${contract.revision}, ${contract.phase}). When the user resumes this work, call goal_progress_get to restore it. Do not reactivate or rebuild it. Restoring progress does not authorize additional execution.`,
    },
  };
}
