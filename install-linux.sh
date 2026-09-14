#!/bin/sh
# Source installation: prepare files and start the core Helper; never restart the desktop.
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
echo '[check] Linux prerequisites / 检查安装条件' >&2
case "${1:-}" in ''|--check) ;; *) echo 'Usage: sh install-linux.sh [--check]' >&2; exit 2;; esac
[ "$(uname -s)" = Linux ] || { echo 'Linux is required.' >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo 'This source installer currently supports Linux x86_64.' >&2; exit 1; }
for tool in node codex systemctl loginctl; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
[ -x /usr/bin/flock ] || { echo "Missing /usr/bin/flock" >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' || { echo 'Node.js 22.12+ required.' >&2; exit 1; }
[ -f "$repo/.agents/plugins/marketplace.json" ] || { echo 'Missing source marketplace manifest.' >&2; exit 1; }
# A degraded manager can still run user services; query the manager, not unrelated units.
systemctl --user show-environment >/dev/null
codex plugin add --help >/dev/null
codex_home=${CODEX_HOME:-"$HOME/.codex"}
export GOAL_PROGRESS_PLUGIN_DATA="$codex_home/plugins/data/codex-goal-progress-codex-goal-progress-local"
if [ "${1:-}" = --check ]; then
  node "$repo/scripts/ensure-local-pnpm.mjs" check "$repo/runtime/package.json" "$GOAL_PROGRESS_PLUGIN_DATA"
  echo 'Linux prerequisites ready. No installation or restart performed.'
  exit 0
fi
GOAL_PROGRESS_PNPM=$(node "$repo/scripts/ensure-local-pnpm.mjs" prepare "$repo/runtime/package.json" "$GOAL_PROGRESS_PLUGIN_DATA")
export GOAL_PROGRESS_PNPM
backup=$(/bin/sh -c '
  set -eu
  mkdir -p "$1"
  directory=$(mktemp -d "$1/goal-progress-install-backup.XXXXXX")
  if [ -f "$1/config.toml" ]; then cp -p "$1/config.toml" "$directory/config.toml"; fi
  printf "%s\n" "$directory"
' sh "$codex_home")
printf 'Configuration backup: %s\n' "$backup"
codex plugin marketplace add "$repo" --json
codex plugin add codex-goal-progress@codex-goal-progress-local --json
export GOAL_PROGRESS_PLUGIN_MARKETPLACE=codex-goal-progress-local
export GOAL_PROGRESS_CODEX_HOME="$codex_home"
/bin/sh "$repo/runtime/run-bootstrap.sh" install-files --rebuild
health=0
/bin/sh "$repo/runtime/run-bootstrap.sh" prepare || health=1
/bin/sh "$repo/runtime/run-bootstrap.sh" doctor || health=1
/bin/sh "$repo/runtime/run-bootstrap.sh" verify || health=1
if [ "$health" -ne 0 ]; then
  echo 'Files prepared and core startup attempted; runtime acceptance is incomplete. Read Doctor/Verify nextStep. No desktop restart was performed.' >&2
  exit 1
fi
echo 'Linux installation and runtime checks passed. No desktop restart was performed.'
