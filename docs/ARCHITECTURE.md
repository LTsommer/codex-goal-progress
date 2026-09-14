# Architecture

Codex Goal Progress adds local tracking to an explicitly selected ordinary task or native Codex Goal. The current
Codex model interprets the requested outcome. Local code validates every update, stores the Contract, computes
the percentage, and renders the result.

## Data flow

```text
Goal Progress Skill
  → runtime proof
  → local MCP tools
  → Helper
  → Core + Event Store
  → display-only ViewModel
  → CDP Page Host
  → Lit Renderer
```

## Component responsibilities

| Component | Responsibility |
|---|---|
| Plugin Skill | Starts progress tracking for the current native Goal |
| Hook | Restores active Contracts and signs Goal Progress tool identity |
| MCP server | Exposes activation, initialization, read, update, rescope, and phase tools |
| Helper | Resolves the current thread, owns writes, reads native Goal and Token state, and publishes ViewModels |
| Core | Validates events and calculates objective and overall progress |
| Event Store | Persists JSONL events and a rebuildable snapshot |
| Codex adapter | Identifies the visible thread, native Goal, and layout geometry |
| Page Host | Maintains one managed Host and selects native or fallback placement |
| Renderer | Displays the ViewModel and emits bounded UI intents |

Helper is the only state writer. Core is the only progress calculator. Renderer displays the
ViewModel.

## Platform boundary

The source runtime selects a CLI entry for the current OS. `platform/linux` owns Linux
application identity, loopback socket verification, user-session discovery, service files,
and desktop launch/restore. `platform/macos` retains its existing launchd, application
signature, and startup-consent behavior. Renderer attachment selects the matching CDP
validator; it does not load the Linux installation orchestrator. Linux CLI injects its
source-plugin update policy into the existing Helper options.

Core IPC readiness and renderer readiness are separate. A missing or delayed desktop
connection must not prevent core task operations or orderly shutdown. Linux preparation
writes installation files without launching the desktop; final Verify requires a real visible
tracked task. Platform setup fingerprints cover each platform's source inputs, while the
macOS fingerprint remains compatible. Checkout source is authoritative during development;
installed plugins build from the generated `runtime/source` tree.

## Activation

Select the **Goal Progress** Skill for a native Goal.

When the Goal already exists:

1. The Hook injects a signed runtime proof.
2. Helper resolves the current thread and reads its native Goal.
3. `goal_progress_activate({})` returns `initialize`, `get`, or `rescope-or-replace`.
4. The current model reuses or prepares a checklist.
5. `goal_progress_initialize` sends only the Contract ID, source, and objectives. Helper binds the
   Contract to the current native Goal it reads at that moment.

When the Goal changes:

- The current model may use Codex native Goal tools to update it.
- A wording-only change keeps the existing checklist.
- A small scope change updates only affected objectives through `goal_progress_rescope`.
- A new delivery target creates a replacement Contract at revision 1.
- The previous Contract remains in event history.

## Progress calculation

Each required top-level objective receives an integer contribution. Required contributions total
10,000 basis points.

Core calculates progress in this order:

1. Calculate each objective's completed checklist ratio.
2. Multiply that ratio by the objective contribution.
3. Add every required objective contribution.
4. Display 95% when every required item is complete and the native Goal remains active.
5. Display 100% after the native Goal completes.

Token usage, elapsed time, command count, and changed-file count stay separate from the
percentage.

## Thread identity

A single Codex Renderer target can host multiple tasks. The adapter reads the unique active
sidebar row and accepts these exact thread formats:

```text
thread_id
host_id:thread_id
```

Helper confirms the same identity through the public App Server thread, turn, and Goal APIs.

## Native and fallback placement

Page Host selects one placement after thread verification:

- **Native**: the native Goal row is available.
- **Managed fallback**: the thread matches while the native Goal row is unavailable.
- **Hidden**: the visible thread changes.
- **Detached**: the user stops tracking.

Route changes, Reload, Composer rebuilds, Helper restarts, and short identity gaps trigger bounded
reconciliation. Native and fallback placement reuse the same Host and ViewModel.

## Renderer adaptation

The Lit Web Component uses Shadow DOM and local CSS.

It reads live Codex values for:

- theme surface and foreground tokens
- accent color
- UI font size
- document locale
- text direction
- native Goal and Composer geometry

Spacing and control sizes derive continuously from the live font token. The current regression
suite covers 11, 14, 16, and 20 px.

The Renderer selects a matching built-in message catalog from the Codex document locale. Other
locales use English UI copy while preserving locale-aware number formatting and the current text
direction.

## Local runtime

The macOS Release includes a self-contained Node Single Executable Application (SEA) Helper.
Runtime data lives under:

```text
~/Library/Application Support/CodexGoalProgress/
```

See [permissions](PERMISSIONS.md) and [support](SUPPORT.md) for the published boundaries.

## Ordinary task tracking

Explicit tracking requests use activation `mode: "task"`. They never create a native Goal or authorize
another execution turn. The existing default activation mode remains `goal`.

V2 records preserve native compatibility and add a `task` field for ordinary tasks. In that mode,
`nativeGoal` and `nativeGoalBinding` are null; the trusted thread identity and generated Contract ID
identify the record. Mixed native/task identities are rejected. Helper remains the sole state writer.

An empty task checklist means scope is unknown: Core projects null progress and the renderer displays
currentStep, findings, and openQuestions. `goal_progress_explore` replaces those exploration details
in one versioned event. Once outcomes are known, `rescope` defines the checklist in the same record.
Exploration cannot complete without a defined accepted result. Checklist completion reaches 95%; an
explicit completed phase with verified final acceptance evidence reaches 100%. Adding scope clears
previous final acceptance. Native completion rules are unchanged.

One thread has one current record. An active record cannot be silently overwritten. A completed or
explicitly detached record may be replaced; replacement events preserve history and the detach fact.
SessionStart restores active tracking, but grants no execution authority. MCP writes stay compact;
ordinary-task reads include saved exploration and checklist details for cross-turn recovery.

Ordinary tasks use a standalone draggable floating host even without a native Goal anchor, without
changing the saved native layout preference. They do not read native Goal Token data or present
thread-wide Token counts as task usage. Progress updates happen at material milestones; there is
no background model polling or extra model invocation.

Development acceptance: `pnpm test`, `pnpm build:demo`, then serve the repository locally and open
`demo/task.html`. The demo uses the real schema, sidecar mount controller and Lit renderer. It does
not establish compatibility with a running Codex installation by itself.

Recovery checklist output is a read-only page of at most 20 target summaries, with parent IDs,
weights, state, evidence counts and a bounded last-evidence summary. Use `nextCursor` with get only
when more target details are needed. A stale cursor requires a fresh first page. Do not write these
summaries back as full evidence. Unchanged result IDs, titles and states preserve stored evidence
when rescoping; changing the result requires new supporting evidence. Full events stay local.

## Source installation restart boundary

Ordinary MCP startup, Hook recovery and automatic preparation do not authorize a Codex restart.
Only an explicit `prepare --restart-codex` / repair invocation can pass restart approval to the
source setup controller. With CDP unavailable, automatic setup fails with
`GOAL_PROGRESS_SOURCE_RESTART_REQUIRED` before any restart is scheduled. The source Helper's
startup observer also returns continue instead of handing off to an application relaunch.
Local installation uses `--rebuild` so same-version source fixes replace stale compiled code;
Socket and setup policy digests additionally reject incompatible cached runtimes.
