import { readFile } from "node:fs/promises";
import { GoalContractSchema, isTaskContract } from "../../contracts/src/index.js";
import { selectProgressTarget } from "../../contracts/src/progress-focus.js";
import { projectGoalProgressViewModel } from "../../core/src/index.js";
import {
  resolveGoalProgressPaths,
  resolveGoalProgressSessionPaths,
} from "../../store/src/paths.js";

import { claudeSessionKey } from "./paths.js";

function plain(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Untrusted titles must not inject terminal controls.
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 100);
}

export async function renderClaudeStatusLine(input: unknown, dataRoot: string): Promise<string> {
  if (
    !input ||
    typeof input !== "object" ||
    !("session_id" in input) ||
    typeof input.session_id !== "string" ||
    !input.session_id.trim()
  )
    return "";
  try {
    const sessionId = claudeSessionKey(input.session_id);
    const paths = resolveGoalProgressSessionPaths(
      resolveGoalProgressPaths({ root: dataRoot }),
      sessionId,
    );
    const snapshot = JSON.parse(await readFile(paths.snapshotPath, "utf8"));
    const contract = GoalContractSchema.parse(snapshot.contract);
    if (
      contract.sessionId !== sessionId ||
      snapshot.sessionId !== sessionId ||
      snapshot.revision !== contract.revision ||
      !isTaskContract(contract)
    )
      return "";
    const result = projectGoalProgressViewModel(contract);
    if (!result.ok) return "";
    const view = result.viewModel;
    const objective = selectProgressTarget(view.objectives);
    const focus =
      objective?.currentItemTitle ??
      objective?.title ??
      view.task?.currentStep ??
      view.objective ??
      "";
    const phase = view.trackingPhase;
    if (view.overallPercent === null)
      return `Goal Progress · ${phase} · exploring · ${plain(focus)}`;
    const filled = Math.floor(view.overallPercent / 10);
    return `Goal Progress [${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${view.overallPercent}% · ${phase} · ${plain(focus)}`;
  } catch {
    return "";
  }
}
