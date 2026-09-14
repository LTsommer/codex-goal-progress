export function desktopExecQuote(value: string): string {
  if (/[\0\r\n]/u.test(value)) throw new Error("LINUX_DESKTOP_EXEC_INVALID");
  // Desktop Entry escaping is distinct from shell and systemd escaping.
  return `"${value.replace(/\\/gu, "\\\\\\\\").replace(/"/gu, '\\\\"').replace(/`/gu, "\\\\`").replace(/\$/gu, "\\\\$").replace(/%/gu, "%%")}"`;
}

export function createManagedDesktopEntry(source: string, wrapper: string, owner: string): string {
  let section = "";
  let count = 0;
  const lines = source.split("\n").map((line) => {
    const group = /^\[([^\]]+)\]\r?$/u.exec(line);
    if (group) section = group[1] ?? "";
    if (section !== "Desktop Entry" || !line.startsWith("Exec=")) return line;
    // Do not reinterpret an unknown desktop invocation or silently lose its switches.
    if (line.replace(/\r$/u, "") !== "Exec=chatgpt %U")
      throw new Error("LINUX_SYSTEM_DESKTOP_EXEC_UNSUPPORTED");
    count++;
    return `Exec=${desktopExecQuote(wrapper)} %U${line.endsWith("\r") ? "\r" : ""}`;
  });
  if (count !== 1) throw new Error("LINUX_SYSTEM_DESKTOP_EXEC_INVALID");
  return `${owner}\n${lines.join("\n")}`;
}

export function validateDesktopArguments(args: readonly string[]): string[] {
  if (args.some((arg) => arg.startsWith("-") || arg.includes("\0")))
    throw new Error("LINUX_DESKTOP_ARGUMENT_UNSUPPORTED");
  return [...args];
}

export function parseLinuxLaunchArguments(args: readonly string[]): {
  restartCodex: boolean;
  args: string[];
} {
  const separator = args.indexOf("--");
  const controls = separator < 0 ? args : args.slice(0, separator);
  if (controls.length > 1 || controls.some((arg) => arg !== "--restart-codex"))
    throw new Error("LINUX_LAUNCH_OPTION_INVALID");
  return {
    restartCodex: controls.includes("--restart-codex"),
    args: validateDesktopArguments(separator < 0 ? [] : args.slice(separator + 1)),
  };
}
