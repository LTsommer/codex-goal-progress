<div align="center">
  <h1 align="center">
    <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-logo.png" alt="Codex Goal Progress 标志" width="130"><br>
    Codex Goal Progress
  </h1>
  <p>为普通任务和 Codex 原生 Goal 提供本地探索记录与清单进度。</p>
  <p>
    <a href="https://github.com/Ezra-Y/codex-goal-progress/blob/main/README.md">English</a> ·
    <strong>简体中文</strong>
  </p>
</div>

## 此 Fork 的开发流程

本仓库是 [ezra-y/codex-goal-progress](https://github.com/ezra-y/codex-goal-progress)
的维护 Fork。此 Fork 中，`upstream` 指向原仓库，`origin` 指向本 Fork。

每项新改动均按以下流程进行：

1. 从本 Fork 同步本地 `main` 基线：

   ```sh
   git switch main
   git fetch origin --prune
   git merge --ff-only origin/main
   ```

2. 从已更新的 `main` 创建新的开发分支：

   ```sh
   git switch -c lt/<feature-name>
   ```

3. 在该分支上开发并验证。创建 PR 前，确保分支只有一条英文提交，格式为
   `[type][module]: concise English summary`。
4. 推送该分支，并向 `main` 创建 PR。

已经合并的分支不再继续承载新的开发工作。

<p align="center">
  <img src="docs/assets/codex-goal-progress-demo.gif" alt="Codex Goal Progress 演示">
</p>

## 🆕 最近更新

### v0.3.7 — 续做更可靠

**更新日期：2026 年 9 月 9 日**

- 同批存在受阻项时，正在进行的工作仍保持可见。
- 页面当前项与续做提示现在指向同一项工作。
- 已完成目标继续扩展时，自动沿用原清单和已确认成果。

## ✨ 功能特性

在 Codex 原生 Goal 旁显示进度视图，集中展示当前小目标、总体进度，以及能够确认归属于该 Goal 的 Token 用量。

| 能力 | 表现 |
|---|---|
| 规则驱动进度 | 根据已验证的 Checklist 计算小目标和总体进度；Token 与耗时保持为独立辅助信息。 |
| 可验证计算 | 模型只负责必要的 Goal 理解和 Checklist 更新；本地 Helper 管理状态并计算进度。 |
| 原生主题适配 | 跟随 Codex 的浅色/深色主题和用户当前选择的强调色。 |
| 字号适配 | 读取 Codex 当前 UI 字号，并由字号连续计算间距。 |
| 布局适配 | 测量真实原生 Goal 和输入框尺寸，协调固定布局与可拖动漂浮布局。 |
| 语言适配 | 读取 Codex 当前文档语言和文字方向，选择对应的内置词典，并以英文作为最终回退。 |

## 🚀 快速开始

### Linux 桌面源码安装

本分支提供 Linux x86_64 打包版 ChatGPT/Codex 桌面适配，使用 systemd 用户服务和受管理的桌面入口。
先运行 `sh ./install-local.sh --check`。支持的应用布局、重启授权和真实桌面验收要求见
[Linux 安装与验收](docs/LINUX.md)。

### Claude Code（命令行／IDE）

本地开发版已加入 Claude Code 适配：通过 `/goal-progress:track` 启动普通任务跟踪，
支持同会话恢复与终端状态栏。范围未知时显示探索状态，不猜百分比。
IDE 可使用相同 Skill 和 MCP 工具；首版没有原生 IDE 图形状态栏。

安装好 Claude Code 和 Node.js 22.12+ 后，在本仓库执行：

```sh
pnpm build:claude
sh ./install-claude.sh
```

已有构建产物时，只需执行 `sh ./dist/claude-marketplace/install-claude.sh`。
安装器会先备份配置，保留已有命令状态栏。随后在 Claude Code 执行 `/reload-plugins`，
再用 `/goal-progress:track 你的任务` 启动。
详见 [Claude Code 安装、使用与验收](docs/CLAUDE-CODE.md)。
下方原仓库的 Codex Release 下载命令尚不包含这份未发布的 Claude 适配。

### 从插件市场安装

源码插件需要 Apple Silicon Mac、Codex Desktop、Node.js 22.12 或更高版本和 pnpm 11。
首次使用时安装锁定版本的依赖，在 Codex 插件数据目录构建 Helper；后续直接复用。
首次安装依赖需要联网。

### 让 AI 安装

把下面这句话发给 AI：

```text
请按照仓库中的 INSTALL-FOR-AI.md，安装并验证 https://github.com/Ezra-Y/codex-goal-progress。
```

### 安装本地修改版

在本仓库目录执行 `sh ./install-local.sh`，或在 Finder 双击 `install-local.command`。
脚本先确认安装及可能发生的 Codex 重启，再备份现有 `config.toml`、注册本地市场、
安装插件、初始化 Helper 并运行 Doctor / Verify。`sh ./install-local.sh --check` 只读检查前置条件，缺少指定版本的 pnpm 时返回失败。
正式安装在取得确认后、注册插件前准备 `runtime/package.json` 指定的 pnpm 版本：优先复用已有版本，缺少时通过 npm 安装到插件数据目录的 `tooling/pnpm-<版本>`，不修改全局 pnpm。需要 Node.js 自带的 npm 可用。
此入口安装本地源码，包含普通任务跟踪扩展；首次初始化需要联网准备依赖。
安装时的重启授权只对当次安装生效。MCP、Hook 和对话恢复不会自行重启 Codex。
CDP 暂时不可用时，Helper 和进度工具仍可读写记录；界面连接状态单独报告。

### 更新或重启后的自动恢复

源码插件默认关闭自动启动接管。需要在 Codex 更新或普通重启后自动恢复进度界面时，
可明确授权以下命令（在已安装插件目录执行）：

```sh
sh runtime/run-bootstrap.sh startup-recovery enable
sh runtime/run-bootstrap.sh startup-recovery status
# 撤销后，未来启动不会再自动接管；不结束当前应用。
sh runtime/run-bootstrap.sh startup-recovery disable
```

此授权持久保存，并限定于授权时验证的应用路径、bundle ID 和签名团队。
启用命令本身不重启应用。以后监听器在安全启动窗口内，可以替换刚启动的普通进程，
带本机调试参数启动应用并恢复界面；即使没有未完成任务，也可恢复插件可用性。
它不允许在错过启动窗口后结束已经在使用的应用，也不允许循环重启。
应用身份不匹配、监听器未及时就绪或不兼容版本导致恢复失败时，工具服务保持独立，
UI 会处于未连接状态；不能保证任何未来版本的界面结构均无需适配。

Doctor / Verify 的 `toolsReady` 表示运行文件与 Helper 服务就绪，`uiConnectionReady` 表示
CDP 连接校验通过；后者不代替进度组件的截图验收。整体 `ok` 仍要求完整健康检查通过。
已有普通进程需要当次恢复时，先取得重启授权，再执行
`sh runtime/run-bootstrap.sh repair --restart-codex`。

启动日志中的 `startup.handoff` 只记录应用接管结果；接管成功后的界面恢复错误单独记为
`startup.ui-recovery / STARTUP_UI_RECOVERY_FAILED`，并保留 `causeCode`。可重试的连接错误
沿用有限重试，签名或应用身份拒绝不会由这条恢复路径重试。

### 从预构建包安装

```bash
curl -fsSL https://github.com/Ezra-Y/codex-goal-progress/releases/latest/download/install.sh -o /tmp/codex-goal-progress-install.sh
sh /tmp/codex-goal-progress-install.sh
```

脚本会下载 macOS 安装包和 `SHA256SUMS`，校验 ZIP，然后运行安装包内置的安装器。
需要重启 Codex 时，脚本会先询问。

安装后按提示重新打开 Codex，再打开一个新任务，让新的 Plugin 会话加载。

## 🛠️ 环境要求

- Apple Silicon Mac
- Codex Desktop
- 源码插件：Node.js 22.12 或更高版本，以及 pnpm 11

预构建 macOS Release 已包含 Node.js 运行时和所需程序。

## 🎯 如何使用

本地扩展支持普通任务和原生 Goal 两种跟踪方式。选择 **Goal Progress** Skill，或明确说
“用 Goal Progress 跟踪这个任务，先调查清楚范围”。普通任务不需要创建 Goal。

- **范围还不清楚**：记录当前调查、已确认事实和待明确问题，不显示百分比。
- **验收范围明确**：建立清单，以完成结果计算进度；阶段性批量更新，不逐次工具调用更新。
- **下次继续**：恢复同一任务保存的清单和证据，不重建；恢复进度本身不授权继续执行。
- **完成**：必需结果完成后提交最终验收证据，才达到 100%。未知范围不能直接标为完成。

普通任务进度默认显示为可拖动浮层，不显示归属不明确的 Token 用量。跟踪不会触发自动续跑、
后台模型轮询或创建隐藏任务，也不是 Token 硬限额控制器。只有明确启用的任务才跟踪。
原生 Goal 跟踪仍保留原有绑定与完成规则。

开发验收：运行 `pnpm test`、`pnpm build:demo`，通过本地静态服务打开 `demo/task.html`。
示例使用真实展示组件，不会发送消息、创建 Goal 或安装插件。

## 🌓 进度状态与主题

### 正在准备验收清单

<p align="center">
  <img src="docs/assets/codex-goal-progress-preparing-light-en.gif" alt="Goal Progress 正在准备验收清单" width="760">
</p>

### 浅色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 浅色主题中的 Goal Progress 固定显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-fixed-en.png) | ![真实 Codex 浅色主题中的 Goal Progress 漂浮显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-light-floating-en.png) |

### 深色

| 固定显示 | 漂浮显示 |
|---|---|
| ![真实 Codex 深色主题中的 Goal Progress 固定显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-fixed-en.png) | ![真实 Codex 深色主题中的 Goal Progress 漂浮显示](https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-dark-floating-en.png) |

## 🧭 工作原理

<p align="center">
  <img src="https://raw.githubusercontent.com/Ezra-Y/codex-goal-progress/main/docs/assets/codex-goal-progress-architecture.png" alt="Codex Goal Progress 工作原理">
</p>

- 当前模型通过本地 MCP 工具更新 Checklist 证据。
- Helper 校验 revision，并作为唯一状态写入者。
- Core 根据 Checklist 计算小目标进度和总体进度。
- Renderer 只接收用于显示的 ViewModel。
- 源码插件在 Codex 插件数据目录中构建 Helper；预构建 Release 使用自包含的 Node SEA Helper。

更多信息请查看[技术架构](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/ARCHITECTURE.md)、
[权限范围](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md)和
[支持说明](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/SUPPORT.md)。

## 🔐 隐私与权限

Goal Progress 使用：

- Codex 插件数据目录或应用支持目录中的本地文件；
- 私有本地 Unix Socket；
- 连接已验证 Codex 进程的 loopback CDP；
- 由 launchd 注册的后台 Helper；
- 三个 Plugin Hook。

完整范围和卸载步骤请查看
[PERMISSIONS.md](https://github.com/Ezra-Y/codex-goal-progress/blob/main/docs/PERMISSIONS.md)。

## 许可证

[MIT](https://github.com/Ezra-Y/codex-goal-progress/blob/main/LICENSE)

源码安装的“检查更新”会查询 GitHub 正式发布版本。“查看更新说明”打开发布说明；请通过 Codex 插件市场安装更新。它不会自动换成预构建 Helper。

卸载源码版时，对 Codex 说“卸载 Goal Progress”即可。工具删除这个源码插件、Helper 和插件进度数据，保留原生 Goal、其他插件和共享市场。先返回“开始卸载”，最终结果写入 `CODEX_HOME/logs/goal-progress-uninstall.log`。
