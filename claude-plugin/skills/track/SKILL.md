---
name: track
description: Track the current ordinary task with Goal Progress when explicitly selected. Never activates solely because work is complex or long.
disable-model-invocation: true
---

# Goal Progress for Claude Code

Track only the user's authorized task. Tracking does not authorize more execution, background models, automatic continuation or a native Goal. Do not create child sessions to maintain progress. Only the main agent writes progress.

Call goal_progress_activate with mode `task`. Follow its progressAction: `get` restores the existing record; `initialize` creates one record; `none` stops activation. Never overwrite an active record for a new topic. The Hook injects `_claudeProof`; never author or copy it.

Initialize with source `existing-checklist` when reusing user acceptance outcomes, otherwise `model-generated`, task `{objective,currentStep,findings,openQuestions}` and objectives. Unknown scope uses `objectives: []`, so no percentage is guessed. Preserve findings and batch explore updates at meaningful milestones, not every tool call.

For known scope, checklist objectives are accepted outcomes, not execution steps. Required contributions sum to 10000 basis points. Use stable IDs C1, C2 and children C1.1. Evidence accompanies completed results. Read [examples](references/contract-examples.md) and [scope rules](references/checklist-and-scope.md) before creating or changing a checklist. Rescope exploration once outcomes are known, with a reason beginning `当前方向：`.

Reuse returned contractId and expectedRevision. Get once on resume or revision conflict, not before each update. Recovery is paginated: follow nextCursor only when needed. Never write recovery summaries back as evidence. Update only material changes; model calls merely to refresh progress are prohibited.

The terminal status line reads local snapshots without model calls. If no status line is configured, the tracking tools still work; summarize progress on request. Do not change settings during a task.

To finish, verify all required outcomes, update supported targets and call goal_progress_set_phase with phase `completed` and verification containing `verification: "verified"`, nonempty summary and source/reference. A reply ending does not complete tracking. Pausing is a record update, not an execution control or token cap.
