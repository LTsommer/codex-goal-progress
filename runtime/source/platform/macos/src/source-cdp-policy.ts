import type { CdpController } from "./cdp-controller.js";

// Only an explicit installation invocation may authorize an application restart.
// Ordinary MCP / Hook setup prepares the core runtime only; UI readiness is independent.
export async function ensureSourceCdp(
  cdp: Pick<CdpController, "verify" | "ensure">,
  restartCodex = false,
): Promise<boolean> {
  if (!restartCodex) return false;
  if (await cdp.verify()) return false;
  return cdp.ensure(true);
}
