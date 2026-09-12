import { spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";

// stdout is a single absolute executable path; diagnostics belong on stderr.
const [mode, manifestPath, dataRoot] = process.argv.slice(2);
try {
  if (!["check", "prepare"].includes(mode) || !manifestPath || !dataRoot) {
    throw new Error("Usage: ensure-local-pnpm.mjs check|prepare manifestPath dataRoot");
  }
  const { packageManager } = JSON.parse(readFileSync(manifestPath, "utf8"));
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager);
  if (!match) throw new Error("runtime packageManager must pin an exact pnpm version");
  const version = match[1];
  const prefix = resolve(dataRoot, "tooling", `pnpm-${version}`);
  const privateBin = join(prefix, "node_modules", ".bin", "pnpm");
  const findExecutable = (name) => {
    const candidates = isAbsolute(name)
      ? [name]
      : (process.env.PATH ?? "").split(delimiter).map((dir) => resolve(dir, name));
    return candidates.find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  };
  const correctVersion = (bin) => {
    if (!bin) return false;
    const result = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
    return result.status === 0 && result.stdout.trim() === version;
  };
  const candidates = [
    process.env.GOAL_PROGRESS_PNPM && findExecutable(process.env.GOAL_PROGRESS_PNPM),
    privateBin,
    findExecutable("pnpm"),
  ];
  let binary = candidates.find(correctVersion);
  if (!binary && mode === "check") {
    throw new Error(`缺少 pnpm ${version}；正式安装会在确认后准备私有依赖。`);
  }
  if (!binary) {
    const npm = findExecutable("npm");
    if (!npm) throw new Error(`缺少 pnpm ${version}，且未找到 npm，无法准备私有依赖。`);
    mkdirSync(prefix, { recursive: true, mode: 0o700 });
    console.error(`正在准备私有 pnpm ${version}：${prefix}`);
    const result = spawnSync(
      npm,
      [
        "install",
        "--prefix",
        prefix,
        "--no-save",
        "--package-lock=false",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `pnpm@${version}`,
      ],
      { stdio: ["ignore", 2, 2], timeout: 180000 },
    );
    if (result.status !== 0 || !correctVersion(privateBin)) {
      throw new Error(`私有 pnpm ${version} 安装或版本校验失败；尚未注册 Codex 插件。`);
    }
    binary = privateBin;
  }
  console.log(binary);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
