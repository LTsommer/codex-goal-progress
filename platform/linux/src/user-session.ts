import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

// MCP launchers may deliberately omit desktop session variables. logind owns
// the runtime-directory mapping; the calling shell is not its authority.
export function linuxUserSessionEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("LINUX_USER_SESSION_UID_REQUIRED");
  const query = spawnSync(
    "loginctl",
    ["show-user", String(uid), "--property=RuntimePath", "--value"],
    {
      encoding: "utf8",
      timeout: 5000,
      env: environment,
    },
  );
  if (query.status !== 0)
    throw new Error("LINUX_USER_SESSION_LOOKUP_FAILED", { cause: query.error });
  const runtimePath = query.stdout.trim();
  if (!isAbsolute(runtimePath) || /[\0\r\n]/u.test(runtimePath)) {
    throw new Error("LINUX_USER_SESSION_PATH_INVALID");
  }
  const directory = lstatSync(runtimePath);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== uid ||
    (directory.mode & 0o777) !== 0o700 ||
    realpathSync(runtimePath) !== runtimePath
  ) {
    throw new Error("LINUX_USER_SESSION_DIRECTORY_INVALID");
  }
  const busPath = resolve(runtimePath, "bus");
  const bus = lstatSync(busPath);
  if (!bus.isSocket() || bus.isSymbolicLink() || bus.uid !== uid) {
    throw new Error("LINUX_USER_SESSION_BUS_INVALID");
  }
  return {
    ...environment,
    XDG_RUNTIME_DIR: runtimePath,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${busPath.split("/").map(encodeURIComponent).join("/")}`,
  };
}

export function linuxGraphicalSessionEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const session = linuxUserSessionEnvironment(environment);
  const query = spawnSync("systemctl", ["--user", "show-environment"], {
    encoding: "utf8",
    timeout: 5000,
    env: session,
  });
  if (query.status !== 0)
    throw new Error("LINUX_GRAPHICAL_SESSION_ENVIRONMENT_UNAVAILABLE", { cause: query.error });

  const graphical: NodeJS.ProcessEnv = {};
  for (const line of query.stdout.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (separator < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || /[\0\r\n]/u.test(value))
      throw new Error("LINUX_GRAPHICAL_SESSION_ENVIRONMENT_INVALID");
    graphical[name] = value;
  }
  const resolved = { ...session, ...graphical };
  if (!resolved.DISPLAY && !resolved.WAYLAND_DISPLAY)
    throw new Error("LINUX_GRAPHICAL_SESSION_ENVIRONMENT_UNAVAILABLE");
  return resolved;
}
