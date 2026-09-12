import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { handleClaudeHook } from "./hooks.js";
import { runClaudeMcpServer } from "./mcp.js";
import { resolveClaudeDataRoot } from "./paths.js";
import { renderClaudeStatusLine } from "./statusline.js";

async function stdinJson(): Promise<unknown> {
  let body = "";
  for await (const chunk of process.stdin) {
    body += String(chunk);
    if (Buffer.byteLength(body) > 1048576) throw new Error("CLAUDE_INPUT_TOO_LARGE");
  }
  return JSON.parse(body);
}
export async function runClaudeCli(args = process.argv.slice(2)) {
  const mode = args[0];
  if (mode === "mcp") {
    await runClaudeMcpServer();
    return;
  }
  if (mode === "hook") {
    const result = await handleClaudeHook(await stdinJson(), resolveClaudeDataRoot());
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (mode === "statusline") {
    const result = await renderClaudeStatusLine(await stdinJson(), resolveClaudeDataRoot());
    if (result) process.stdout.write(`${result}\n`);
    return;
  }
  throw new Error("Usage: goal-progress mcp|hook|statusline");
}

// Bundled CLI supplies an explicit invocation; source execution remains useful in tests.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  runClaudeCli().catch((error: unknown) => {
    if (process.argv[2] === "statusline") return;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = process.argv[2] === "hook" ? 2 : 1;
  });
}
