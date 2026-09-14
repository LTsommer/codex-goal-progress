import { execFile } from "node:child_process";
import { runHookCli } from "../../../hooks/src/index.js";
import { runHelperCli } from "../../../packages/host/src/index.js";
import { runMcpServer } from "../../../packages/mcp/src/index.js";
import { goalProgressReleaseUrl } from "../../macos/src/update-release.js";
import { parseLinuxLaunchArguments } from "./desktop-entry.js";
import {
  ensureLinuxSourceRuntime,
  inspectLinuxSourceRuntime,
  launchLinuxCodexManaged,
  prepareLinuxSourceRuntime,
  uninstallLinuxSourceRuntime,
  withLinuxRuntimeOperation,
} from "./runtime.js";

export async function runGoalProgressCli(argv = process.argv.slice(2)): Promise<void> {
  if (process.platform !== "linux") throw new Error("GOAL_PROGRESS_LINUX_REQUIRED");
  if (
    [
      "__linux-prepare",
      "install",
      "__source-runtime-ensure",
      "repair",
      "__linux-launch",
      "uninstall",
      "__source-runtime-uninstall",
    ].includes(argv[0] ?? "")
  )
    return withLinuxRuntimeOperation(() => dispatchLinuxCli(argv));
  return dispatchLinuxCli(argv);
}
async function dispatchLinuxCli(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command === "hook") return runHookCli();
  if (command === "mcp-server") return runMcpServer();
  if (command === "serve")
    return runHelperCli(argv, {
      sourcePluginRuntime: true,
      openUpdateRelease: async (version) => {
        const url = goalProgressReleaseUrl(version);
        await new Promise<void>((done, reject) => {
          execFile("xdg-open", [url], { timeout: 15000 }, (error) => {
            if (error)
              reject(new Error("GOAL_PROGRESS_UPDATE_RELEASE_OPEN_FAILED", { cause: error }));
            else done();
          });
        });
      },
    });
  let result: { ok: boolean; code: string; nextStep?: string | null };
  const allowed =
    command === "__source-runtime-ensure" || command === "repair"
      ? ["--restart-codex", "--json"]
      : command === "uninstall" || command === "__source-runtime-uninstall"
        ? ["--json", "--delete-history"]
        : ["--json"];
  if (command !== "__linux-launch" && argv.slice(1).some((arg) => !allowed.includes(arg)))
    throw new Error("LINUX_CLI_OPTION_INVALID");
  if (command === "__linux-prepare" || command === "install") {
    result = await prepareLinuxSourceRuntime();
  } else if (command === "__source-runtime-ensure" || command === "repair") {
    result = await ensureLinuxSourceRuntime({ restartCodex: argv.includes("--restart-codex") });
  } else if (command === "__linux-launch") {
    await launchLinuxCodexManaged(parseLinuxLaunchArguments(argv.slice(1)));
    result = await ensureLinuxSourceRuntime();
  } else if (command === "doctor" || command === "verify") {
    result = await inspectLinuxSourceRuntime(command);
  } else if (command === "uninstall" || command === "__source-runtime-uninstall") {
    result = await uninstallLinuxSourceRuntime();
  } else if (command === "upgrade") {
    result = {
      ok: false,
      code: "PLUGIN_MARKETPLACE_UPDATE_REQUIRED",
      nextStep: "Update the local source plugin and rerun its installer.",
    };
  } else {
    throw new Error(`GOAL_PROGRESS_COMMAND_INVALID: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
