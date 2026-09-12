import type {
  GoalContract,
  GoalContractInitialization,
  GoalEvidence,
  GoalObjective,
  GoalProgressCommand,
} from "../../contracts/src/index.js";

export function sanitizeModelEvidence(evidence: GoalEvidence): GoalEvidence {
  return {
    ...evidence,
    source: "model",
    verification: "reported",
  };
}

export function sanitizeModelObjective(
  objective: GoalObjective,
  previous?: GoalObjective,
): GoalObjective {
  const sameResult = (
    next: { id: string; title: string; status: string },
    stored?: { id: string; title: string; status: string },
  ) =>
    stored !== undefined &&
    next.id === stored.id &&
    next.title === stored.title &&
    next.status === stored.status;
  const previousItems = new Map(
    (previous?.id === objective.id ? previous.items : []).map((item) => [item.id, item]),
  );
  const unchanged =
    sameResult(objective, previous) &&
    previous?.items.length === objective.items.length &&
    objective.items.every((item) => sameResult(item, previousItems.get(item.id)));
  return {
    ...objective,
    // A rescope copies existing facts; only changed results bring new model reports.
    evidence:
      unchanged && previous ? previous.evidence : objective.evidence.map(sanitizeModelEvidence),
    items: objective.items.map((item) => {
      const stored = previousItems.get(item.id);
      return {
        ...item,
        evidence:
          sameResult(item, stored) && stored
            ? stored.evidence
            : item.evidence.map(sanitizeModelEvidence),
      };
    }),
  };
}

export function sanitizeModelCommand(
  command: GoalProgressCommand,
  previous?: GoalContract,
): GoalProgressCommand {
  if (command.type === "update-items") {
    return {
      ...command,
      source: "model",
      changes: command.changes.map((change) => ({
        ...change,
        ...(change.evidence ? { evidence: change.evidence.map(sanitizeModelEvidence) } : {}),
      })),
    };
  }
  if (command.type === "rescope") {
    return {
      ...command,
      source: "model",
      objectives: command.objectives.map((objective) =>
        sanitizeModelObjective(
          objective,
          previous?.objectives.find((stored) => stored.id === objective.id),
        ),
      ),
    };
  }
  if (command.type === "set-phase" && command.verification) {
    return {
      ...command,
      source: "model",
      verification: { ...command.verification, source: "model" },
    };
  }
  return { ...command, source: "model" };
}

/** Construct ordinary tracking without any dependency on a host's native Goal. */
export function createTaskContract(
  initialization: GoalContractInitialization,
  identity: { threadId: string; sessionTreeId: string },
  occurredAt: string,
): GoalContract {
  if (!initialization.task)
    throw new Error("TASK_REQUIRED: ordinary tracking requires task metadata");
  return {
    schemaVersion: 2,
    contractId: initialization.contractId,
    sessionId: identity.threadId,
    sessionTreeId: identity.sessionTreeId,
    threadId: identity.threadId,
    nativeGoalBinding: null,
    nativeGoal: null,
    task: initialization.task,
    phase: "active",
    revision: 1,
    scopeRevision: 0,
    source: initialization.source,
    objectives: initialization.objectives.map((objective) => sanitizeModelObjective(objective)),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}
