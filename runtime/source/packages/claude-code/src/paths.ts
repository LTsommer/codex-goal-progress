import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

export function resolveClaudeDataRoot(): string {
  const configured = process.env.GOAL_PROGRESS_CLAUDE_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
  if (configured !== undefined) {
    if (!configured.trim() || !isAbsolute(configured) || /\$|\{\{|\0/.test(configured)) {
      throw new Error("CLAUDE_DATA_PATH_INVALID: expected an expanded absolute path");
    }
    return resolve(configured);
  }
  return resolve(
    process.env.CLAUDE_CONFIG_DIR || resolve(homedir(), ".claude"),
    "plugins/data/goal-progress-goal-progress-local",
  );
}

export function claudeSessionKey(sessionId: string): string {
  if (!sessionId.trim()) throw new Error("CLAUDE_SESSION_INVALID");
  return `claude:${createHash("sha256").update(sessionId).digest("hex")}`;
}
