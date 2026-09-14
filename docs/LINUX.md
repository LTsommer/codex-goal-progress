# Linux source installation

Goal Progress supports source installation for the Linux x86_64 packaged ChatGPT/Codex desktop app. It requires Node.js 22.12+, Codex CLI plugin support, a systemd user manager with logind, `flock`, and a local graphical session. The installer prepares pinned pnpm when needed. It does not install the desktop application.

## Installation and startup

When invoking `runtime/run-bootstrap.sh` directly from this checkout, set the same local
plugin context used by the installer (its child process cannot export variables back to your shell):

```sh
export GOAL_PROGRESS_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export GOAL_PROGRESS_PLUGIN_MARKETPLACE=codex-goal-progress-local
export GOAL_PROGRESS_PLUGIN_DATA="$GOAL_PROGRESS_CODEX_HOME/plugins/data/codex-goal-progress-codex-goal-progress-local"
```

Run `sh ./install-local.sh --check` to check prerequisites, then `sh ./install-local.sh` to register the local plugin, prepare its service and desktop entries, and start the core Helper. The installer backs up `config.toml`, creates the user service `codex-goal-progress.service`, and adds a user-level override for `chatgpt.desktop`. The system desktop file stays unchanged. The override preserves icon, MIME associations, and URL/file arguments; any existing user entry is backed up for uninstall. A separate **Codex with Goal Progress** entry is also created.

The current app layout is `/usr/lib/chatgpt/ChatGPT`, with `resources/app.asar`, `resources/linux-package-metadata.json`, and `/usr/share/applications/chatgpt.desktop`. `GOAL_PROGRESS_CODEX_EXECUTABLE` can select another executable with the same verified app layout; it does not change the system desktop-entry path. Arbitrary Electron applications are not accepted.

The `install-files` preparation step writes owned files and reloads systemd unit definitions without starting the Helper or desktop. The full installer then runs `prepare` without restart permission to start the core Helper, followed by Doctor and Verify. A fresh installation can report incomplete UI acceptance even when the core is ready. To rerun core startup and Doctor without restarting the desktop:

```sh
export GOAL_PROGRESS_CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export GOAL_PROGRESS_PLUGIN_MARKETPLACE=codex-goal-progress-local
export GOAL_PROGRESS_PLUGIN_DATA="$GOAL_PROGRESS_CODEX_HOME/plugins/data/codex-goal-progress-codex-goal-progress-local"
sh ./runtime/run-bootstrap.sh prepare
sh ./runtime/run-bootstrap.sh doctor
```

Core IPC starts independently of CDP and renderer availability. If CDP is absent, `prepare` succeeds with `SETUP_CORE_READY`, `helperReady: true`, `cdpReady: false`, and an explicit UI recovery next step. This allows the MCP entrypoint to start and core tools to work. It does not launch or restart the desktop. Doctor can report `DOCTOR_OK` with `helperReady: true` and `cdpReady: false`, together with the UI error. This means the core service is healthy, not that desktop integration has passed.

Open the managed desktop entry from the actual graphical session to launch the app with its local debugging endpoint. If an existing unmanaged desktop must be restarted, obtain explicit restart permission before running:

```sh
sh ./runtime/run-bootstrap.sh prepare --restart-codex
```

This permits a graceful restart when required and reuses an already verified managed instance. It does not force-kill an unresponsive app. Reopening the managed icon focuses the existing instance and forwards URL/file arguments. Starting the system executable directly bypasses managed startup.

## Reinstalling changed local source

Use this flow when testing uncommitted changes in an existing checkout. Build the renderer and source
package first:

```sh
node scripts/build_renderer_bundle.mjs
node scripts/build_plugin_package.mjs
```

Do not use a generic plugin cachebuster: this source plugin intentionally keeps its plugin, runtime,
and source-bundle versions aligned. Check `codex plugin list --json`. If the configured
`codex-goal-progress-local` marketplace points at another source, switch it through the CLI, then
replace only the installed plugin cache:

```sh
codex plugin marketplace remove codex-goal-progress-local --json
codex plugin marketplace add "$PWD" --json
codex plugin remove codex-goal-progress@codex-goal-progress-local --json
codex plugin add codex-goal-progress@codex-goal-progress-local --json
```

These commands do not delete the checkout. From that checkout, set the source context shown above and
run `install-files --rebuild`, followed by `prepare` and `doctor`. Obtain a separate explicit user
authorization before one `prepare --restart-codex`; wait for its final result instead of issuing
another restart while systemd stops the old Helper. After the desktop opens, use a new Codex thread
and select **Goal Progress** or enter `$codex-goal-progress:goal-progress`. The native `/goal`
command is not this plugin. Final `verify` still requires an active, visible tracked task.

The Helper service receives its session bus location from logind with ownership and permission checks. Desktop launches inherit the actual graphical session environment. Session-bus discovery does not replace display or input-method configuration.

## Verification

Doctor checks the built runtime, installed entrypoints, service, process identity, and core IPC. It reports CDP readiness separately. Verify additionally requires verified CDP ownership and exactly one visible tracked task whose thread matches the real renderer:

```sh
sh ./runtime/run-bootstrap.sh verify
```

Open a real task and explicitly activate Goal Progress tracking before final Verify. Missing CDP produces `LINUX_CDP_NOT_VERIFIED`; missing or mismatched task UI produces `LINUX_RENDERER_NOT_VERIFIED`. A successful core ping or CDP connection alone cannot pass Verify.

Desktop and Helper receipts use process identity and the runtime bundle digest to reuse a verified session and reconnect when the desktop changes. Linux identity checks include executable, UID, process start ticks, boot ID, and ownership of loopback listening sockets. No macOS signature is claimed.

## Validation boundary and removal

Cross-platform tests cover desktop-entry serialization, argument handling, policy fingerprints, and bootstrap dispatch. Linux-only tests cover runtime preparation fixtures with real `flock`, `/proc` identity, process locks, and bundled source runtime behavior. These do not replace an authenticated desktop task or real renderer verification. Local macOS checks cannot establish Linux desktop acceptance.

Uninstall removes plugin data according to the existing Goal Progress uninstall contract and restores the backed-up user desktop entry, or removes the owned override when no prior entry existed. It leaves the desktop process running. Small coordination lock files under `$CODEX_HOME/plugins/goal-progress-coordination/` remain so concurrent uninstall and reinstall operations share the same lock; these files contain no task history.

The optional real-app CDP regression runs only on Linux with a separate temporary profile:

```sh
xvfb-run -a env GOAL_PROGRESS_RUN_OWL_INTEGRATION=1 node --import tsx tests/linux-owl-runtime.integration.ts
```

It starts and stops its own isolated desktop process and is excluded from the default test suite.
It does not establish authenticated task or native Goal UI acceptance.
