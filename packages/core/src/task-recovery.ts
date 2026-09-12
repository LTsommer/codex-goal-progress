import type {
  GoalChecklistItem,
  GoalChecklistRecoveryItem,
  GoalContract,
  GoalEvidence,
  GoalObjective,
} from "../../contracts/src/index.js";
export class TaskRecoveryError extends Error {
  constructor(
    readonly code: "INVALID_COMMAND" | "REVISION_CONFLICT",
    message: string,
    readonly currentRevision: number,
  ) {
    super(message);
    this.name = "TaskRecoveryError";
  }
}

const RECOVERY_PAGE_SIZE = 20;

function summarizeEvidence(evidence: readonly GoalEvidence[]) {
  const last = evidence.reduce<GoalEvidence | undefined>(
    (latest, candidate) =>
      !latest || Date.parse(candidate.observedAt) >= Date.parse(latest.observedAt)
        ? candidate
        : latest,
    undefined,
  );
  return {
    evidenceCount: evidence.length,
    ...(last
      ? {
          lastEvidence: {
            id: last.id,
            summary: last.summary.slice(0, 160),
            verification: last.verification,
            ...(last.reference ? { reference: last.reference.slice(0, 256) } : {}),
          },
        }
      : {}),
  };
}

/** Read-only, revision-bound recovery pages; persistent evidence is never truncated. */
export function taskRecoveryPage(
  contract: GoalContract,
  cursor?: string,
): { checklist: GoalChecklistRecoveryItem[]; nextCursor: string | null } {
  let offset = 0;
  if (cursor !== undefined) {
    const match = /^(\d+):(\d+)$/u.exec(cursor);
    if (!match) {
      throw new TaskRecoveryError("INVALID_COMMAND", "Invalid recovery cursor", contract.revision);
    }
    const revision = Number(match[1]);
    offset = Number(match[2]);
    if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(offset)) {
      throw new TaskRecoveryError("INVALID_COMMAND", "Invalid recovery cursor", contract.revision);
    }
    if (revision !== contract.revision) {
      throw new TaskRecoveryError(
        "REVISION_CONFLICT",
        "Tracking changed; restart recovery from the first page",
        contract.revision,
      );
    }
  }
  const count = contract.objectives.reduce(
    (total, objective) => total + 1 + objective.items.length,
    0,
  );
  if (offset > 0 && offset >= count) {
    throw new TaskRecoveryError(
      "INVALID_COMMAND",
      "Recovery cursor is outside the checklist",
      contract.revision,
    );
  }
  // Flatten in persisted objective/item order and materialize summaries only for this page.
  const entries = contract.objectives.flatMap<{
    objective: GoalObjective;
    item: GoalChecklistItem | null;
  }>((objective) => [
    { objective, item: null },
    ...objective.items.map((item) => ({ objective, item })),
  ]);
  const checklist = entries.slice(offset, offset + RECOVERY_PAGE_SIZE).map(({ objective, item }) =>
    item
      ? {
          id: item.id,
          parentId: objective.id,
          title: item.title,
          status: item.status,
          ...summarizeEvidence(item.evidence),
        }
      : {
          id: objective.id,
          parentId: null,
          title: objective.title,
          status: objective.status,
          requirement: objective.requirement,
          contributionBps: objective.contributionBps,
          contributionReason: objective.contributionReason,
          ...summarizeEvidence(objective.evidence),
        },
  );
  return {
    checklist,
    nextCursor:
      offset + RECOVERY_PAGE_SIZE < count
        ? `${contract.revision}:${offset + RECOVERY_PAGE_SIZE}`
        : null,
  };
}
