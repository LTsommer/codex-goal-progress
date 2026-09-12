# Claude Code

Goal Progress supports explicitly requested ordinary-task tracking in Claude Code. It does not create Codex Goals, run Codex/CDP/launchd, make background model calls, or automatically continue a task.

## Build and install

Developers build the self-contained plugin (MCP SDK included):

```sh
pnpm build:claude
sh ./install-claude.sh --check
sh ./install-claude.sh
```

The distribution is `dist/claude-marketplace`. End users need Claude Code and Node.js 22.12 or newer; no pnpm is needed to run the built plugin. The installer neither installs Claude Code nor authenticates it. It registers the local marketplace and installs `goal-progress@goal-progress-local` for the current user.

The built directory includes its own installer. Copy the entire directory to a stable location and run:

```sh
sh /path/to/claude-marketplace/install-claude.sh
```

This adaptation has not been published to the upstream GitHub release. Its existing Codex download command will not install the Claude plugin. Claude Code installation instructions are available in the [official setup guide](https://code.claude.com/docs/en/setup).

Before invoking either Claude installation command, the installer saves existing Claude settings and a `.state.json` record (including whether settings did not exist). It then composes an existing command status line with the progress line. It preserves unrelated fields and the original command text. Use `--no-statusline` to install only the plugin. `--check` is read-only. Keep the distribution directory available because the status line references its bundled entry point. Re-run the installer after relocating it.

In Claude Code run `/reload-plugins`, then:

```text
/goal-progress:track Investigate why this project starts slowly. This turn only investigate and report; do not change code.
```

Unknown scope displays `exploring`, current work and phase, without a percentage. Define accepted outcomes once scope is known. A known checklist displays a short progress bar; required outcomes plus final verified acceptance are needed for 100%. The status line reads the current session snapshot without writing it or calling a model. No record means no progress line. Token totals are not displayed because task attribution is not established.

Continue in the same Claude session to recover the saved record. The Hook supplies the actual Claude session identity, and MCP writes require that trusted identity. Claude records are separate from Codex records. Only explicit activation creates a record.

In IDE integrations the Skill and tools work through Claude Code; the progress bar described here belongs to the terminal status line. This version does not add a native VS Code or JetBrains status-bar component.

The plugin's server is scoped as `plugin:goal-progress:goal_progress`; the full tool prefix is `mcp__plugin_goal-progress_goal_progress__`. Hook matching and signature verification use that exact namespace, following [Anthropic's plugin tool naming reference](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/mcp-integration/references/tool-usage.md).

The local proof key prevents authored MCP arguments from claiming another session. It is not a security boundary against other programs with access to the same OS user's private files. Subagent writes are rejected. A forked/new Claude session starts with its own record; resume the original session to recover its progress.

## Verification and rollback

Use `sh ./install-claude.sh --check` to check prerequisites without changing settings. In a real Claude session activate the Skill, confirm an exploration line, create outcomes, and restore the same session. A different session must not show or mutate that record. Synthetic integration tests do not substitute for this client acceptance.

Development verification on macOS with Claude Code 2.1.266:

- The actual CLI validated the marketplace and plugin, installed and reinstalled them in an isolated `CLAUDE_CONFIG_DIR`, and discovered the `track` Skill and both Hooks.
- `claude mcp list` reported the scoped plugin server as `Connected` from a clean working directory. This repository's root `.mcp.json` is Codex-specific and causes a separate Claude project-config diagnostic if the health check is run here.
- Tests execute the bundled Hook, stdio MCP and status-line entry points, including task lifecycle, restore, rejected replay/session switching, concurrent writers and preserved existing status-line commands.
- Final verification passed formatting, TypeScript, both builds, plugin contracts and release hygiene. All 36 tests passed; Unix-socket tests required a test environment that permits local socket listeners.
- No authenticated model turn or real interactive `/goal-progress:track` conversation was run. Interactive terminal repaint and IDE integration still require user-session acceptance; CLI discovery and the transport tests do not establish those results.

Progress maintenance does not run extra model sessions. Skill instructions and tool results consume normal context in the current conversation; the renderer and Hooks run locally.

To remove the plugin, use `claude plugin uninstall goal-progress@goal-progress-local`. Restore only the previous `statusLine` field from the installer backup (or `goal-progress-statusline/config.json`'s `previous` field), preserving unrelated settings changed since installation. Progress data is not deleted by the installer.
