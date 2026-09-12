#!/bin/sh
# Install this local checkout, including its ordinary-task tracking extension.
set -eu
umask 077
PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export PATH

gp_repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
gp_home=${CODEX_HOME:-"$HOME/.codex"}
gp_marketplace=codex-goal-progress-local
export GOAL_PROGRESS_PLUGIN_DATA="$gp_home/plugins/data/codex-goal-progress-$gp_marketplace"

fail() { printf '\n安装未完成：%s\n' "$*" >&2; exit 1; }

case "${1:-}" in
  --help|-h)
    printf '用法：sh "%s/install-local.sh" [--check]\n--check 只检查安装条件，不安装或重启。\n' "$gp_repo"
    exit 0 ;;
  ''|--check) ;;
  *) fail "未知参数：$1" ;;
esac

[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail '需要 Apple Silicon Mac。'
[ -f "$gp_repo/.agents/plugins/marketplace.json" ] || fail '请在完整的本地仓库中运行此脚本。'
[ -f "$gp_repo/runtime/run-bootstrap.sh" ] || fail '缺少源码安装入口。'
command -v codex >/dev/null 2>&1 || fail '未找到 Codex CLI，请先安装或将它加入 PATH。'
command -v node >/dev/null 2>&1 || fail '需要 Node.js 22.12 或更新版本。'
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=12)?0:1)' || fail '需要 Node.js 22.12 或更新版本。'
codex plugin add --help >/dev/null || fail '当前 Codex CLI 不支持插件安装。'

printf '\n将安装本地普通任务跟踪版：\n%s\n' "$gp_repo"
if [ "${1:-}" = --check ]; then
  node "$gp_repo/scripts/ensure-local-pnpm.mjs" check "$gp_repo/runtime/package.json" "$GOAL_PROGRESS_PLUGIN_DATA" || fail 'pnpm 前置检查未通过。'
  printf '前置检查通过。尚未安装、下载依赖或重启 Codex。\n'
  exit 0
fi

printf '\n首次初始化需要联网准备依赖并注册后台 Helper，可能自动重启 Codex。\n请先保存工作。是否安装并允许所需的重启？[y/N] '
IFS= read -r gp_answer || exit 0
case "$gp_answer" in y|Y|yes|YES) ;; *) printf '已取消，未执行安装。\n'; exit 0 ;; esac

GOAL_PROGRESS_PNPM=$(node "$gp_repo/scripts/ensure-local-pnpm.mjs" prepare "$gp_repo/runtime/package.json" "$GOAL_PROGRESS_PLUGIN_DATA") || fail 'pnpm 准备失败。'
export GOAL_PROGRESS_PNPM

mkdir -p "$gp_home"
gp_backup=$(mktemp -d "$gp_home/goal-progress-install-backup.XXXXXX")
if [ -f "$gp_home/config.toml" ]; then
  cp -p "$gp_home/config.toml" "$gp_backup/config.toml"
fi
printf '\n配置备份目录：%s\n' "$gp_backup"

printf '\n[1/4] 注册本地插件市场\n'
codex plugin marketplace add "$gp_repo" --json || fail '本地插件市场注册失败。'
printf '\n[2/4] 安装本地插件\n'
codex plugin add "codex-goal-progress@$gp_marketplace" --json || fail '插件安装失败。'

export GOAL_PROGRESS_PLUGIN_MARKETPLACE="$gp_marketplace"
export GOAL_PROGRESS_CODEX_HOME="$gp_home"
printf '\n[3/4] 准备并启动本地 Helper（此步骤可能重启 Codex）\n'
/bin/sh "$gp_repo/runtime/run-bootstrap.sh" prepare --rebuild --restart-codex || fail 'Helper 初始化失败，请查看上方错误。'

printf '\n[4/4] 运行 Doctor 和 Verify\n'
gp_health=0
/bin/sh "$gp_repo/runtime/run-bootstrap.sh" doctor || gp_health=1
/bin/sh "$gp_repo/runtime/run-bootstrap.sh" verify || gp_health=1
[ "$gp_health" -eq 0 ] || fail '健康检查未通过，请按 JSON 中的 nextStep 处理；不要当作安装成功。'

printf '\n安装及健康检查已完成。请在 Codex 新任务中选择 Goal Progress，或明确要求它跟踪普通任务。\n无需创建原生 Goal。是否实际发生重启，请以上方初始化输出与 Codex 窗口状态为准。\n'
