import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  type GoalContract,
  GoalContractInitializationSchema,
  GoalContractSchema,
  type GoalProgressCommand,
  GoalProgressCommandSchema,
} from "../../contracts/src/index.js";
import { selectProgressTarget } from "../../contracts/src/progress-focus.js";
import {
  createTaskContract,
  projectGoalProgressViewModel,
  sanitizeModelCommand,
  taskRecoveryPage,
} from "../../core/src/index.js";
import {
  acquireHelperInstanceLock,
  GoalEventStore,
  resolveGoalProgressPaths,
} from "../../store/src/index.js";
import type { ClaudeAuthorizedIdentity } from "./identity.js";
import { claudeSessionKey } from "./paths.js";

export class ClaudeTaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision: number | null = null,
  ) {
    super(message);
  }
}

export class ClaudeTaskService {
  readonly #store: GoalEventStore;
  constructor(readonly dataRoot: string) {
    this.#store = new GoalEventStore(resolveGoalProgressPaths({ root: dataRoot }));
  }

  async #locked<T>(sessionKey: string, action: () => Promise<T>): Promise<T> {
    // Reuse the existing process-identity lock, scoped to this session's writer.
    // No Helper, socket, App Server, or application lifecycle is started here.
    const key = createHash("sha256").update(sessionKey).digest("hex");
    const paths = resolveGoalProgressPaths({ root: resolve(this.dataRoot, "writers", key) });
    let lock: Awaited<ReturnType<typeof acquireHelperInstanceLock>>;
    try {
      lock = await acquireHelperInstanceLock(paths);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "HELPER_ALREADY_RUNNING") {
        throw new ClaudeTaskError(
          "CLAUDE_SESSION_BUSY",
          "Another request is writing this session; retry after it finishes.",
        );
      }
      throw error;
    }
    try {
      return await action();
    } finally {
      await lock.release();
    }
  }

  #result(
    contract: GoalContract,
    duplicate: boolean | null = null,
    cursor?: string,
    recovery = false,
  ) {
    const projected = projectGoalProgressViewModel(contract);
    if (!projected.ok)
      throw new ClaudeTaskError(projected.code, projected.message, contract.revision);
    const view = projected.viewModel;
    const objective = selectProgressTarget(view.objectives);
    const storedObjective = contract.objectives.find((item) => item.id === objective?.id);
    const currentTarget = selectProgressTarget(storedObjective?.items ?? []);
    return {
      ok: true,
      code: "OK",
      contractId: contract.contractId,
      revision: contract.revision,
      phase: view.trackingPhase,
      overallPercent: view.overallPercent,
      currentTargetId: currentTarget?.id ?? objective?.id ?? null,
      duplicate,
      summary:
        view.overallPercent === null
          ? `Exploring: ${contract.task?.currentStep ?? "scope unknown"}`
          : `${view.trackingPhase}: ${view.overallPercent}%`,
      ...(recovery ? { task: contract.task, ...taskRecoveryPage(contract, cursor) } : {}),
    };
  }

  async run(toolName: string, input: Record<string, unknown>, identity: ClaudeAuthorizedIdentity) {
    const sessionKey = claudeSessionKey(identity.sessionId);
    return this.#locked(sessionKey, async () => {
      const loaded = await this.#store.load(sessionKey);
      const contract = loaded.contract ? GoalContractSchema.parse(loaded.contract) : null;
      if (contract && (!contract.task || contract.threadId !== sessionKey)) {
        throw new ClaudeTaskError(
          "CLAUDE_CONTRACT_MISMATCH",
          "The record does not belong to this ordinary Claude session.",
        );
      }
      if (toolName === "goal_progress_activate") {
        const reuse = contract && contract.phase !== "completed";
        return {
          ok: true,
          code: reuse ? "TASK_GET" : "TASK_INITIALIZE",
          progressAction: reuse ? "get" : "initialize",
          contractId: reuse ? contract.contractId : null,
          revision: reuse ? contract.revision : null,
          summary: "Tracking only; no Goal or additional execution is started.",
        };
      }
      if (toolName === "goal_progress_get") {
        return contract
          ? this.#result(contract, null, input.cursor as string | undefined, true)
          : {
              ok: true,
              code: "NOT_INITIALIZED",
              contractId: null,
              revision: null,
              summary: "Use the track Skill to explicitly initialize this task.",
            };
      }
      const id = createHash("sha256").update(`${sessionKey}\0${identity.toolUseId}`).digest("hex");
      const metadata = {
        eventId: `evt-${id}`,
        requestId: `req-${id}`,
        // Internal request correlation, not a fabricated native Codex turn identity.
        turnId: identity.promptId
          ? `claude-prompt:${createHash("sha256").update(identity.promptId).digest("hex")}`
          : `claude-call:${id}`,
        occurredAt: new Date().toISOString(),
        source: "model" as const,
      };
      if (toolName === "goal_progress_initialize") {
        const initialization = GoalContractInitializationSchema.parse({
          ...input,
          contractId: `gp_${id}`,
        });
        const next = createTaskContract(
          initialization,
          { threadId: sessionKey, sessionTreeId: sessionKey },
          metadata.occurredAt,
        );
        if (contract && contract.contractId !== next.contractId && contract.phase !== "completed") {
          throw new ClaudeTaskError(
            "TRACKING_ALREADY_ACTIVE",
            "Reuse the active record; do not replace the current task silently.",
            contract.revision,
          );
        }
        const written =
          contract && contract.contractId !== next.contractId
            ? await this.#store.replace(next, metadata, {
                contractId: contract.contractId,
                revision: contract.revision,
              })
            : await this.#store.initialize(next, metadata);
        return this.#result(GoalContractSchema.parse(written.contract), written.duplicate);
      }
      if (!contract)
        throw new ClaudeTaskError("NOT_INITIALIZED", "Initialize this task before updating it.");
      const types: Record<string, GoalProgressCommand["type"]> = {
        goal_progress_explore: "update-exploration",
        goal_progress_update: "update-items",
        goal_progress_rescope: "rescope",
        goal_progress_set_phase: "set-phase",
      };
      const type = types[toolName];
      if (!type)
        throw new ClaudeTaskError("TOOL_NOT_SUPPORTED", "Unsupported Claude task operation.");
      const command = GoalProgressCommandSchema.parse({
        ...input,
        ...metadata,
        type,
        sessionId: sessionKey,
      });
      const written = await this.#store.apply(sanitizeModelCommand(command, contract));
      if (!written.ok)
        throw new ClaudeTaskError(written.code, written.message, written.currentRevision);
      return this.#result(GoalContractSchema.parse(written.contract), written.duplicate);
    });
  }
}
