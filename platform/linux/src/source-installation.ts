import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { GOAL_PROGRESS_RELEASE_VERSION } from "../../../packages/contracts/src/index.js";
import { atomicWriteFile, resolveGoalProgressPaths } from "../../../packages/store/src/index.js";
import { inspectLinuxCodexApp } from "./cdp-runtime.js";
import { createManagedDesktopEntry, desktopExecQuote } from "./desktop-entry.js";
import { linuxUserSessionEnvironment } from "./user-session.js";

export const SERVICE = "codex-goal-progress.service";
export const LINUX_SYSTEMD_COMMAND_TIMEOUT_MS = 15_000;
export const LINUX_SYSTEMD_RESTART_TIMEOUT_MS = 105_000;
const fail = (code: string): never => {
  throw new Error(code);
};
const digest = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
export function configuration() {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || !isAbsolute(value) || /[\n\r\0]/u.test(value))
      fail(`LINUX_RUNTIME_ENV_INVALID: ${name}`);
    return resolve(value ?? fail("LINUX_RUNTIME_ENV_INVALID"));
  };
  const root = required("GOAL_PROGRESS_PLUGIN_DATA");
  const runtimeRoot = required("GOAL_PROGRESS_SOURCE_RUNTIME_ROOT");
  const launcher = required("GOAL_PROGRESS_SOURCE_LAUNCHER");
  const bundle = required("GOAL_PROGRESS_SOURCE_BUNDLE");
  const renderer = required("GOAL_PROGRESS_RENDERER_BUNDLE_DIR");
  const codexHome = required("GOAL_PROGRESS_CODEX_HOME");
  if (
    required("GOAL_PROGRESS_ROOT") !== root ||
    !runtimeRoot.startsWith(root + sep) ||
    [launcher, bundle, renderer].some((path) => !path.startsWith(runtimeRoot + sep))
  )
    fail("LINUX_RUNTIME_PATH_MISMATCH");
  const configHome = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), ".config");
  const dataHome = process.env.XDG_DATA_HOME ?? resolve(homedir(), ".local/share");
  if (!isAbsolute(configHome) || !isAbsolute(dataHome)) fail("LINUX_XDG_PATH_INVALID");
  return {
    root,
    runtimeRoot,
    launcher,
    bundle,
    renderer,
    codexHome,
    service: resolve(configHome, "systemd/user", SERVICE),
    desktop: resolve(dataHome, "applications/codex-goal-progress.desktop"),
    normalDesktop: resolve(dataHome, "applications/chatgpt.desktop"),
    paths: resolveGoalProgressPaths({ root }),
  };
}
export function systemctlTimeoutMs(args: readonly string[]): number {
  return args[0] === "restart"
    ? LINUX_SYSTEMD_RESTART_TIMEOUT_MS
    : LINUX_SYSTEMD_COMMAND_TIMEOUT_MS;
}

export function systemctl(args: string[]): string {
  const result = spawnSync("systemctl", ["--user", ...args], {
    encoding: "utf8",
    timeout: systemctlTimeoutMs(args),
    env: linuxUserSessionEnvironment(),
  });
  if (result.status !== 0)
    fail(
      `LINUX_SYSTEMD_FAILED: ${args[0]}: ${result.stderr?.trim() || result.error?.message || result.status}`,
    );
  return result.stdout.trim();
}
export function linuxSystemdQuote(value: string): string {
  if (/[\0\n\r]/u.test(value)) fail("LINUX_SERVICE_VALUE_INVALID");
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/%/gu, "%%")}"`;
}
export interface LinuxRuntimeResult {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  code: string;
  changed: boolean;
  nextStep: string | null;
  details: Record<string, unknown>;
}
export const result = (
  command: string,
  ok: boolean,
  code: string,
  changed: boolean,
  details: Record<string, unknown> = {},
): LinuxRuntimeResult => ({
  schemaVersion: 1,
  command,
  ok,
  code,
  changed,
  nextStep: ok
    ? null
    : "Inspect the reported Linux runtime failure; restart the desktop only with explicit approval.",
  details,
});
interface InstalledFile {
  previousDigest?: string;
  path: string;
  content: string;
  mode: number;
}
async function installationTransaction(files: InstalledFile[], owner: string): Promise<void> {
  const previous = new Map<string, { content: string; mode: number } | null>();
  for (const file of files) {
    try {
      const metadata = await lstat(file.path);
      const content = await readFile(file.path, "utf8");
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.uid !== process.getuid?.() ||
        (metadata.mode & 0o022) !== 0 ||
        (!content.includes(owner) && digest(content) !== file.previousDigest)
      )
        fail("LINUX_INSTALLATION_OWNER_MISMATCH");
      previous.set(file.path, { content, mode: metadata.mode & 0o777 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      previous.set(file.path, null);
    }
  }
  const written: string[] = [];
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
      written.push(file.path);
      await atomicWriteFile(file.path, file.content);
      await chmod(file.path, file.mode);
    }
    systemctl(["daemon-reload"]);
  } catch (cause) {
    try {
      for (const path of written.reverse()) {
        const old = previous.get(path);
        if (old) {
          await atomicWriteFile(path, old.content);
          await chmod(path, old.mode);
        } else await rm(path, { force: true });
      }
      systemctl(["daemon-reload"]);
    } catch (error) {
      throw new Error("LINUX_INSTALL_ROLLBACK_FAILED", { cause: error });
    }
    throw cause;
  }
}
export async function verifyInstalledEntrypoints(): Promise<void> {
  const c = configuration();
  const recordPath = resolve(c.paths.runtimeRoot, "linux-installation.json");
  const metadata = await lstat(recordPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o077) !== 0
  )
    fail("LINUX_INSTALL_RECORD_INVALID");
  const record = JSON.parse(await readFile(recordPath, "utf8")) as {
    schemaVersion: number;
    owner: string;
    launcher: string;
    files: Array<{ path: string; sha256: string; mode: number }>;
  };
  const expected = [
    c.service,
    c.desktop,
    c.normalDesktop,
    resolve(c.paths.runtimeRoot, "linux-desktop-backup.json"),
    resolve(c.runtimeRoot, "bin/linux-desktop-launcher"),
  ];
  if (
    record.schemaVersion !== 1 ||
    record.owner !== `# Goal Progress owner: ${c.root}` ||
    record.launcher !== c.launcher ||
    !Array.isArray(record.files) ||
    record.files.length !== expected.length ||
    new Set(record.files.map((file) => file.path)).size !== expected.length
  )
    fail("LINUX_INSTALL_RECORD_INVALID");
  for (const file of record.files) {
    if (!expected.includes(file.path)) fail("LINUX_INSTALL_RECORD_PATH_INVALID");
    const stat = await lstat(file.path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== file.mode ||
      digest(await readFile(file.path)) !== file.sha256
    )
      fail("LINUX_INSTALL_ENTRYPOINT_CHANGED");
  }
  if (
    !(await readFile(c.service, "utf8")).includes(
      `ExecStart=${linuxSystemdQuote(c.launcher)} serve\n`,
    )
  )
    fail("LINUX_SERVICE_EXEC_INVALID");
  if (
    !(await readFile(c.service, "utf8")).includes(
      `GOAL_PROGRESS_RUNTIME_DIGEST=${digest(await readFile(c.bundle))}`,
    )
  )
    fail("LINUX_SERVICE_RUNTIME_DIGEST_STALE");
}
export async function prepareLinuxSourceRuntime(
  options: { systemDesktopPath?: string } = {},
): Promise<LinuxRuntimeResult> {
  const c = configuration();
  const app = await inspectLinuxCodexApp();
  await access(c.launcher, constants.X_OK);
  await access(c.bundle, constants.R_OK);
  systemctl(["show-environment"]);
  const environment: Record<string, string> = {
    HOME: homedir(),
    CODEX_HOME: c.codexHome,
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    GOAL_PROGRESS_ROOT: c.root,
    GOAL_PROGRESS_PLUGIN_DATA: c.root,
    GOAL_PROGRESS_SOURCE_RUNTIME: "1",
    GOAL_PROGRESS_RUNTIME_DIGEST: digest(await readFile(c.bundle)),
    GOAL_PROGRESS_SOURCE_RUNTIME_ROOT: c.runtimeRoot,
    GOAL_PROGRESS_SOURCE_LAUNCHER: c.launcher,
    GOAL_PROGRESS_SOURCE_BUNDLE: c.bundle,
    GOAL_PROGRESS_RENDERER_BUNDLE_DIR: c.renderer,
    GOAL_PROGRESS_CODEX_HOME: c.codexHome,
    GOAL_PROGRESS_CODEX_EXECUTABLE: app.realExecutablePath,
  };
  for (const name of [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "GOAL_PROGRESS_CODEX_COMMAND",
    "GOAL_PROGRESS_NODE_BINARY",
    "GOAL_PROGRESS_PLUGIN_MARKETPLACE",
    "GOAL_PROGRESS_PLUGIN_ROOT",
  ]) {
    const value = process.env[name];
    if (value) environment[name] = value;
  }
  const owner = `# Goal Progress owner: ${c.root}`;
  const service = `${owner}\n[Unit]\nDescription=Codex Goal Progress\n[Service]\nType=simple\nExecStart=${linuxSystemdQuote(c.launcher)} serve\n${Object.entries(
    environment,
  )
    .map(([key, value]) => `Environment=${linuxSystemdQuote(`${key}=${value}`)}`)
    .join(
      "\n",
    )}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n[Install]\nWantedBy=default.target\n`;

  // Separate launcher preserves the existing desktop entry and its normal startup behavior.
  const wrapper = resolve(c.runtimeRoot, "bin/linux-desktop-launcher");
  const shellQuote = (value: string): string => `'${value.replace(/'/gu, "'\\''")}'`;
  const wrapperContent = `#!/bin/sh\n${owner}\nset -eu\n${Object.entries(environment)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n")}\nexec ${shellQuote(c.launcher)} __linux-launch -- "$@"\n`;
  const desktop = `${owner}\n[Desktop Entry]\nType=Application\nName=Codex with Goal Progress\nExec=${desktopExecQuote(wrapper)}\nTerminal=false\n`;
  const backupPath = resolve(c.paths.runtimeRoot, "linux-desktop-backup.json");
  let backup: {
    owner: string;
    path: string;
    original: { content: string; mode: number; sha256: string } | null;
  };
  let overrideSource = await readFile(
    options.systemDesktopPath ?? "/usr/share/applications/chatgpt.desktop",
    "utf8",
  );
  const existingBackup = await lstat(backupPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existingBackup) {
    const meta = existingBackup;
    if (
      !meta.isFile() ||
      meta.isSymbolicLink() ||
      meta.uid !== process.getuid?.() ||
      (meta.mode & 0o077) !== 0
    )
      fail("LINUX_DESKTOP_BACKUP_INVALID");
    backup = JSON.parse(await readFile(backupPath, "utf8"));
    if (
      backup.owner !== owner ||
      backup.path !== c.normalDesktop ||
      (backup.original !== null &&
        (typeof backup.original.content !== "string" ||
          digest(backup.original.content) !== backup.original.sha256 ||
          !Number.isInteger(backup.original.mode) ||
          backup.original.mode < 0 ||
          backup.original.mode > 0o777))
    )
      fail("LINUX_DESKTOP_BACKUP_INVALID");
    const installed = JSON.parse(
      await readFile(resolve(c.paths.runtimeRoot, "linux-installation.json"), "utf8"),
    ) as { files?: Array<{ path: string; sha256: string }> };
    for (const protectedPath of [backupPath, c.normalDesktop]) {
      const record = installed.files?.find((file) => file.path === protectedPath);
      if (!record || digest(await readFile(protectedPath)) !== record.sha256)
        fail("LINUX_DESKTOP_INSTALLED_DIGEST_CHANGED");
    }
    if (backup.original) overrideSource = backup.original.content;
  } else {
    let original: { content: string; mode: number; sha256: string } | null = null;
    try {
      const meta = await lstat(c.normalDesktop);
      if (
        !meta.isFile() ||
        meta.isSymbolicLink() ||
        meta.uid !== process.getuid?.() ||
        (meta.mode & 0o022) !== 0
      )
        fail("LINUX_DESKTOP_OWNER_INVALID");
      const content = await readFile(c.normalDesktop, "utf8");
      if (content.includes("# Goal Progress owner:")) fail("LINUX_DESKTOP_BACKUP_MISSING");
      original = { content, mode: meta.mode & 0o777, sha256: digest(content) };
      overrideSource = content;
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
    backup = { owner, path: c.normalDesktop, original };
  }
  const normalDesktop = createManagedDesktopEntry(overrideSource, wrapper, owner);
  const files: InstalledFile[] = [
    { path: backupPath, content: `${JSON.stringify(backup)}\n`, mode: 0o600 },
    {
      path: c.normalDesktop,
      content: normalDesktop,
      mode: 0o600,
      ...(backup.original ? { previousDigest: backup.original.sha256 } : {}),
    },
    { path: c.service, content: service, mode: 0o600 },
    { path: c.desktop, content: desktop, mode: 0o600 },
    { path: wrapper, content: wrapperContent, mode: 0o700 },
  ];
  const record = {
    schemaVersion: 1,
    owner,
    launcher: c.launcher,
    files: files.map((file) => ({
      path: file.path,
      sha256: digest(file.content),
      mode: file.mode,
    })),
  };
  await installationTransaction(
    [
      ...files,
      {
        path: resolve(c.paths.runtimeRoot, "linux-installation.json"),
        content: `${JSON.stringify(record)}\n`,
        mode: 0o600,
      },
    ],
    owner,
  );
  return result("prepare", true, "LINUX_RUNTIME_PREPARED", true, {
    service: c.service,
    desktop: c.desktop,
    wrapper,
    normalDesktop: c.normalDesktop,
    app,
    installationComplete: false,
    serviceStarted: false,
  });
}
export async function verifyFiles(): Promise<void> {
  const c = configuration();
  const manifest = JSON.parse(await readFile(resolve(c.runtimeRoot, "manifest.json"), "utf8")) as {
    schemaVersion: number;
    releaseVersion: string;
    files: Record<string, { path: string; bytes: number; sha256: string }>;
  };
  if (manifest.schemaVersion !== 1 || manifest.releaseVersion !== GOAL_PROGRESS_RELEASE_VERSION)
    fail("LINUX_RUNTIME_MANIFEST_VERSION_INVALID");
  for (const path of [
    "bin/goal-progress",
    "bin/goal-progress.cjs",
    "bin/node-runtime.sh",
    "renderer/goal-progress.js",
    "renderer/goal-progress.manifest.json",
  ])
    if (!manifest.files?.[path]) fail("LINUX_RUNTIME_MANIFEST_INCOMPLETE");
  for (const [key, record] of Object.entries(manifest.files)) {
    const path = resolve(c.runtimeRoot, record.path);
    if (key !== record.path || !path.startsWith(c.runtimeRoot + sep))
      fail("LINUX_RUNTIME_MANIFEST_PATH_INVALID");
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size !== record.bytes ||
      digest(await readFile(path)) !== record.sha256
    )
      fail("LINUX_RUNTIME_FILES_INVALID");
  }
}
export async function uninstallLinuxSourceRuntime(): Promise<LinuxRuntimeResult> {
  const c = configuration();
  const owner = `# Goal Progress owner: ${c.root}`;
  for (const path of [c.service, c.desktop]) {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.uid !== process.getuid?.() ||
      !(await readFile(path, "utf8")).startsWith(`${owner}\n`)
    )
      fail("LINUX_UNINSTALL_OWNER_MISMATCH");
  }
  const marketplace = process.env.GOAL_PROGRESS_PLUGIN_MARKETPLACE;
  if (
    !marketplace ||
    !/^[a-zA-Z0-9._-]+$/u.test(marketplace) ||
    c.root !== resolve(c.codexHome, "plugins/data", `codex-goal-progress-${marketplace}`)
  )
    fail("LINUX_UNINSTALL_DATA_PATH_INVALID");
  const rootMetadata = await lstat(c.root);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    rootMetadata.uid !== process.getuid?.() ||
    (await realpath(c.root)) !== c.root
  )
    fail("LINUX_UNINSTALL_DATA_OWNER_INVALID");
  const allowed = new Set([
    "source-runtime",
    "runtime",
    "state",
    "logs",
    "preferences",
    "install",
    "tooling",
  ]);
  for (const entry of await readdir(c.root))
    if (!allowed.has(entry)) fail("LINUX_UNINSTALL_UNKNOWN_DATA");
  try {
    const tooling = resolve(c.root, "tooling");
    const metadata = await lstat(tooling);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.())
      fail("LINUX_UNINSTALL_TOOLING_OWNER_INVALID");
    for (const name of await readdir(tooling)) {
      if (!/^pnpm-\d+\.\d+\.\d+$/u.test(name)) fail("LINUX_UNINSTALL_UNKNOWN_TOOLING");
      const item = await lstat(resolve(tooling, name));
      if (!item.isDirectory() || item.isSymbolicLink() || item.uid !== process.getuid?.())
        fail("LINUX_UNINSTALL_TOOLING_OWNER_INVALID");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await verifyInstalledEntrypoints();
  const app = await inspectLinuxCodexApp();
  const cli = resolve(app.realAppPath, "resources/codex");
  const cliMetadata = await lstat(cli);
  if (!cliMetadata.isFile() || cliMetadata.isSymbolicLink() || (cliMetadata.mode & 0o022) !== 0)
    fail("LINUX_CODEX_CLI_INVALID");
  await access(cli, constants.X_OK);
  const pluginId = `codex-goal-progress@${marketplace}`;
  const runPlugin = (args: string[]): unknown => {
    const execution = spawnSync(cli, ["plugin", ...args, "--json"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, CODEX_HOME: c.codexHome },
    });
    if (execution.status !== 0) fail(`LINUX_PLUGIN_COMMAND_FAILED: ${args[0]}`);
    return JSON.parse(execution.stdout);
  };
  const before = runPlugin(["list"]) as {
    installed?: Array<{ pluginId: string; installed: boolean }>;
  };
  if (
    !Array.isArray(before.installed) ||
    !before.installed.some((plugin) => plugin.pluginId === pluginId && plugin.installed)
  )
    fail("LINUX_UNINSTALL_PLUGIN_NOT_INSTALLED");
  const backupPath = resolve(c.paths.runtimeRoot, "linux-desktop-backup.json");
  const backup = JSON.parse(await readFile(backupPath, "utf8")) as {
    path: string;
    original: { content: string; mode: number; sha256: string } | null;
  };
  if (
    backup.path !== c.normalDesktop ||
    (backup.original && digest(backup.original.content) !== backup.original.sha256)
  )
    fail("LINUX_DESKTOP_BACKUP_INVALID");
  systemctl(["disable", "--now", SERVICE]);
  runPlugin(["remove", pluginId]);
  const after = runPlugin(["list"]) as {
    installed?: Array<{ pluginId: string; installed: boolean }>;
  };
  if (
    !Array.isArray(after.installed) ||
    after.installed.some((plugin) => plugin.pluginId === pluginId && plugin.installed)
  )
    fail("LINUX_UNINSTALL_PLUGIN_STILL_INSTALLED");
  if (backup.original) {
    await atomicWriteFile(c.normalDesktop, backup.original.content);
    await chmod(c.normalDesktop, backup.original.mode);
  } else await rm(c.normalDesktop);
  await rm(c.service);
  await rm(c.desktop);
  systemctl(["daemon-reload"]);
  // The CLI promises cache removal, not data deletion. Remove only the preflight-verified plugin root.
  await rm(c.root, { recursive: true, force: true });
  return result("uninstall", true, "UNINSTALL_OK", true, {
    pluginRemoved: true,
    dataDeleted: true,
    marketplacePreserved: true,
    desktopProcessPreserved: true,
  });
}
