import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  GOAL_PROGRESS_RELEASE_VERSION,
  GoalContractIdSchema,
  GoalEvidenceSchema,
  GoalExplorationUpdateSchema,
  GoalObjectiveSchema,
  GoalProgressItemChangeSchema,
  GoalTaskInitializationSchema,
} from "../../contracts/src/index.js";
import { ClaudeIdentityVerifier } from "./identity.js";
import { resolveClaudeDataRoot } from "./paths.js";
import { ClaudeTaskService } from "./task-service.js";

const writeFields = {
  contractId: GoalContractIdSchema,
  expectedRevision: z.number().int().nonnegative(),
};
export const claudeToolSchemas = {
  goal_progress_activate: z.object({ mode: z.literal("task").optional() }).strict(),
  goal_progress_initialize: z
    .object({
      source: z.enum(["existing-checklist", "model-generated"]),
      task: GoalTaskInitializationSchema,
      objectives: z.array(GoalObjectiveSchema).max(100),
    })
    .strict(),
  goal_progress_get: z
    .object({
      cursor: z
        .string()
        .max(64)
        .regex(/^\d+:\d+$/)
        .optional(),
    })
    .strict(),
  goal_progress_explore: GoalExplorationUpdateSchema.extend(writeFields).strict(),
  goal_progress_update: z
    .object({
      ...writeFields,
      changes: z.array(GoalProgressItemChangeSchema).min(1).max(500),
      activeObjectiveId: z.string().nullable().optional(),
      correctionReason: z.string().min(1).max(2000).optional(),
    })
    .strict(),
  goal_progress_rescope: z
    .object({
      ...writeFields,
      reason: z.string().min(1).max(2000),
      objectives: z.array(GoalObjectiveSchema).min(1).max(100),
    })
    .strict(),
  goal_progress_set_phase: z
    .object({
      ...writeFields,
      phase: z.enum(["active", "paused", "completed"]),
      verification: GoalEvidenceSchema.optional(),
    })
    .strict(),
};
const descriptions: Record<keyof typeof claudeToolSchemas, string> = {
  goal_progress_activate:
    "Plan explicitly requested ordinary-task tracking. No native Goal, model call or automatic continuation is started.",
  goal_progress_initialize:
    "Initialize this Claude session's task. Unknown scope uses objectives=[]. IDs are generated locally; do not replace an active record.",
  goal_progress_get:
    "Restore task metadata and a read-only page of target summaries. Read further pages only when needed; evidence summaries are not write payloads.",
  goal_progress_explore:
    "Batch material exploration findings. All three exploration fields are required and replace their prior values; preserve confirmed findings.",
  goal_progress_update:
    "Update existing results when supported by evidence. Do not change scope or weights.",
  goal_progress_rescope:
    "Define acceptance outcomes after exploration or update a changed scope, keeping unchanged IDs, titles and states to preserve evidence.",
  goal_progress_set_phase:
    "Pause, resume or finish tracking. Completion requires all required results and an explicit verified final acceptance evidence object.",
};

export function createClaudeMcpServer(dataRoot = resolveClaudeDataRoot()) {
  const server = new McpServer({ name: "goal-progress", version: GOAL_PROGRESS_RELEASE_VERSION });
  const verifier = new ClaudeIdentityVerifier(dataRoot);
  const service = new ClaudeTaskService(dataRoot);
  for (const name of Object.keys(claudeToolSchemas) as Array<keyof typeof claudeToolSchemas>) {
    const schema: z.ZodObject = claudeToolSchemas[name];
    server.registerTool(
      name,
      {
        description: descriptions[name],
        inputSchema: schema.extend({
          _claudeProof: z
            .unknown()
            .optional()
            .describe("Injected only by the Claude PreToolUse Hook. Never author this field."),
        }),
        annotations: {
          readOnlyHint: name === "goal_progress_get",
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (raw) => {
        let output: Record<string, unknown>;
        try {
          const { _claudeProof, ...business } = raw;
          const identity = await verifier.authorize(
            `mcp__plugin_goal-progress_goal_progress__${name}`,
            _claudeProof,
          );
          output = await service.run(name, business, identity);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown task error";
          const code =
            error instanceof z.ZodError
              ? "INVALID_INPUT"
              : error instanceof Error && "code" in error
                ? String(error.code)
                : (/^[A-Z][A-Z0-9_]+/.exec(message)?.[0] ?? "CLAUDE_TASK_ERROR");
          output = {
            ok: false,
            code,
            summary:
              error instanceof z.ZodError
                ? (error.issues[0]?.message ?? "Invalid input")
                : message.slice(0, 500),
            currentRevision:
              error instanceof Error && "currentRevision" in error ? error.currentRevision : null,
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
          structuredContent: output,
          isError: output.ok === false,
        };
      },
    );
  }
  return server;
}

export async function runClaudeMcpServer() {
  await createClaudeMcpServer().connect(new StdioServerTransport());
}
