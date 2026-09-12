# Ordinary Claude task examples

These are business arguments only. The Hook injects `_claudeProof`; never author it.

First call `goal_progress_activate({"mode":"task"})`. If it returns `initialize`, use:

```json
{
  "source": "model-generated",
  "task": {
    "objective": "Find and fix the slow startup",
    "currentStep": "Identify the slow startup segment",
    "findings": [],
    "openQuestions": ["Which subsystem accounts for the delay?"]
  },
  "objectives": []
}
```

`goal_progress_initialize` generates the Contract ID. Copy the returned ID and revision for writes.
For `goal_progress_explore`, provide `contractId`, `expectedRevision`, and all three exploration
fields (`currentStep`, `findings`, `openQuestions`). Omitted fields are errors; explicit empty arrays
clear them. Preserve earlier confirmed findings.

Once scope is known, call `goal_progress_rescope` with the returned ID/revision, a reason beginning
`当前方向：`, and the complete agreed checklist. One outcome can be represented as:

```json
{
  "id": "C1",
  "title": "Startup meets the agreed acceptance target",
  "requirement": "required",
  "contributionBps": 10000,
  "contributionReason": "The agreed delivery is the startup performance result",
  "status": "pending",
  "evidence": [],
  "items": []
}
```

Update existing outcomes with `goal_progress_update`, sending only changed targets. Evidence is a
reported observation from the model, not an independent validator attestation. Example evidence
shape (replace every example fact and timestamp with actual observations):

```json
{
  "id": "acceptance-1",
  "kind": "test",
  "verification": "verified",
  "summary": "The agreed startup acceptance test passed",
  "reference": "test-results/startup.txt",
  "observedAt": "2026-09-10T00:00:00Z",
  "source": "model"
}
```

To finish, all required outcomes must be completed. Call `goal_progress_set_phase` with
`phase: "completed"` and a separate `verification` object describing final acceptance. A task with
unknown scope or without final acceptance cannot complete. Use `paused` / `active` for tracking
state only; these are not commands to continue model execution.

`get` returns at most 20 flat target summaries per page. `parentId` is null for objectives and is
the parent objective ID for child items. The last-evidence summary is truncated and must not be
copied back as a full evidence record. Unchanged result IDs/titles/states preserve stored evidence
when rescoping; new results need new evidence. Read more pages only when needed.
