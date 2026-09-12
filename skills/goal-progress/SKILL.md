---
name: goal-progress
description: Track an explicitly requested ordinary task or native Codex Goal with local progress. Use when the user selects Goal Progress, invokes $codex-goal-progress:goal-progress, or explicitly asks to track this task with this tool. Do not activate merely because work is complex, long, or has a plan.
---

# Goal Progress

Goal Progress records progress for the current task. Tracking never authorizes additional work,
creates a native Goal, or schedules another execution turn.

## Entry

Start only after explicit Skill selection, the canonical marker, or an explicit request to track
this task with Goal Progress. Ordinary questions, a plan, and inferred complexity do not activate it.
Use the current thread and current model. Do not create hidden tasks, child agents or model calls
for progress maintenance. Only the main execution agent writes progress.
Hooks supply `_runtimeContext` and `_runtimeProof`; omit both from authored arguments.

When trusted SessionStart context reports an active Contract, restore it with `goal_progress_get`
when work resumes. Reuse its task/checklist state, IDs and evidence. Do not reactivate or rebuild.
Restoring tracking does not authorize continuing execution beyond the user's current request.

## Start Or Resume

1. Preserve the user's task and execution boundaries. Remove only pure Skill marker lines.
2. For ordinary-task tracking call `goal_progress_activate({"mode":"task"})`.
   For an explicitly requested existing native Goal use `{"mode":"goal"}` (also the API default).
   If mode=goal reports `NATIVE_GOAL_REQUIRED`, use mode=task; never create a Goal merely to show progress.
3. Follow `progressAction`:
   - `get`: call `goal_progress_get` and reuse the existing record.
   - `initialize`: initialize once, omitting `contractId`.
   - `rescope-or-replace`: follow the native Goal change procedure below.
   - `none`: stop activation calls.
4. Ordinary initialization includes `task: {objective, currentStep, findings, openQuestions}` and
   `source`. If scope is unknown, send `objectives: []`; no percentage will be displayed.
   If acceptance outcomes are known, provide the Checklist using the existing outcome rules.
   Native Goal initialization omits `task`; Helper binds the trusted Goal.
5. Report active only after initialize/get succeeds.

A thread has one current record. Do not overwrite active tracking for a new topic. Finish it or let
its user explicitly stop tracking first. A new explicit activation can start another task after
completion; old events remain in history. Do not revive completed work just because a turn starts.

## Ordinary Task Exploration

Use `goal_progress_explore` only when material findings change during unknown scope. Send the current
`contractId`, `expectedRevision`, and complete currentStep/findings/openQuestions. Preserve earlier
confirmed findings. Batch changes at milestones or before the current turn ends; never update after
every tool call or use repeated polling. Routine reads and attempts are not completed outcomes.

Once scope is known, use `goal_progress_rescope` with acceptance outcomes and a reason beginning
`当前方向：`. This reuses the record and exploration history. Exploration cannot be marked complete
without a defined accepted result (for a research-only task, that result may be the delivered report).

## Update Cadence And Execution Boundaries

Update existing items only after material results, blockers or scope changes. Reuse current revisions;
call get after resuming or a revision conflict, not before every write. Writes return compact results;
get returns ordinary-task metadata and its saved checklist for recovery.

Do not rebuild the checklist, reweight it, start background model polling, or open another task to
maintain progress. Empty or unchanged updates are unnecessary. Stop at the user's requested boundary
even when checklist items remain. Pausing tracking with `set_phase` is available for ordinary tasks;
it is a local record change, not an execution control or a Token cap.

## IDs At A Glance

- First initialization: omit `contractId`. Later writes copy the returned `contractId` unchanged.
- Objective IDs: `C1`, `C2`. Child IDs: `C1.1`, `C1.2`, `C2.1`. These are not UUIDs.
- Reuse IDs for existing results, even after reordering or renaming. Correct only the field named
  in a validation error; leave the native Goal and accepted Checklist unchanged.

## Checklist

Before generating a Checklist for the first time, changing the acceptance scope, or replacing a
Contract, read [Checklist organization and scope changes](references/checklist-and-scope.md).

When restoring existing progress or updating completion status, continue using the existing
Checklist, IDs, and weights.

## Work Loop

Keep `update_plan` as an execution plan. Never turn its steps into the Goal denominator.
Complete normal Goal work. After a concrete fact is completed or verified, call
`goal_progress_get`, then `goal_progress_update` with stable target IDs and the returned revision.
Leave uncertain work unchanged. Active work alone does not earn progress.
Never call a model merely to refresh progress. Core computes every percentage.
On a revision conflict, review the returned current summary before retrying.

## Native Goal Changes

Only when the user explicitly requests that native Goal action, the model may create or update it with Codex native Goal tools. Goal Progress follows
the trusted current native Goal after that change.
When the trusted native Goal changes, classify the change as minor or major in the current model.
Do not use text similarity, another model, or another thread.
Do not ask the user to invoke Goal Progress again.
A wording-only change keeps the existing Checklist. A minor scope change keeps the Contract and
uses `goal_progress_rescope` for affected results only.
A major change prepares a fresh Contract and uses `goal_progress_initialize`.
Ordinary implementation, bug-fix, or `update_plan` changes do neither.

## Finish

Run final verification and update only supported remaining targets.
For ordinary tasks, all required outcomes must be complete. Call `goal_progress_set_phase` with
`phase: "completed"` and `verification` containing actual final acceptance evidence, including
`verification: "verified"`, a nonempty summary and its source/reference. Do not mark complete merely
because a reply or investigation turn ended. Do not call native Goal tools for ordinary tracking.
For native Goals, preserve the existing rule: both Checklist and native Goal must complete.

## References

- [Activation and recovery](references/activation-and-recovery.md)
- [Checklist and scope](references/checklist-and-scope.md)
- [Contract examples](references/contract-examples.md)

## Uninstall

For an explicit request to uninstall the source plugin, call `goal_progress_uninstall` when available. It removes this plugin, its Helper and its progress data while keeping native Goals and other plugins. Do not use uninstall to finish or hide a Goal. The first response means removal has started; the returned status log contains the final result.

Recovery checklist output is a read-only page of at most 20 target summaries, with parent IDs,
weights, state, evidence counts and a bounded last-evidence summary. Use `nextCursor` with get only
when more target details are needed. A stale cursor requires a fresh first page. Do not write these
summaries back as full evidence. Unchanged result IDs, titles and states preserve stored evidence
when rescoping; changing the result requires new supporting evidence. Full events stay local.
