# Activation And Recovery

Explicit Skill selection or a direct request to track this task is required. Never activate based
only on inferred complexity. Tracking does not authorize another execution turn.

## Mode

- Ordinary task: `goal_progress_activate({"mode":"task"})`. No native Goal is read or created for binding.
- Existing native Goal: `goal_progress_activate({"mode":"goal"})`, also the API default.
- If native mode returns `NATIVE_GOAL_REQUIRED`, use task mode for explicitly requested tracking.
  Do not create a Goal just for this plugin.

## Actions

- `get`: restore saved state with `goal_progress_get`, preserving IDs, evidence and contributions.
- `initialize`: send source and objectives, omitting contractId. Ordinary tasks additionally send
  task.objective and exploration details. Unknown scope uses an empty objectives array.
- `rescope-or-replace`: native Goal change; preserve unaffected results for minor changes and
  replace for a major delivery change.
- `none`: stop activation calls.

An active record cannot be silently replaced by another topic or mode. Complete it, or let the
user stop tracking, before explicitly starting a new task. History is preserved.

## Recovery

When trusted SessionStart context reports an active record, call get when work resumes. Do not
activate again, regenerate its checklist, or treat restoration as authorization to continue work.
Only report active after initialize/get succeeds.

`ACTIVATION_CANCELLED` or `TRACKING_DETACHED_BY_USER` means the user closed tracking. Do not retry
until explicitly asked to enable it again. Temporary infrastructure failure is not cancellation:
report the code and use a bounded retry or Doctor. Do not create a Goal as a workaround.
