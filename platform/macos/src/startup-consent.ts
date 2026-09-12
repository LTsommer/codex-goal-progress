import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { atomicWriteFile } from "../../../packages/store/src/atomic.js";
import type { GoalProgressPaths } from "../../../packages/store/src/paths.js";
import { CODEX_BUNDLE_ID, CODEX_TEAM_ID, type CodexMacosAppIdentity } from "./app-discovery.js";

const ConsentSchema = z
  .object({
    schemaVersion: z.literal(1),
    appPath: z.string().startsWith("/"),
    bundleId: z.literal(CODEX_BUNDLE_ID),
    teamId: z.literal(CODEX_TEAM_ID),
    grantedAt: z.string().datetime(),
  })
  .strict();
export type StartupRecoveryConsent = z.infer<typeof ConsentSchema>;

export async function readStartupRecoveryConsent(
  paths: GoalProgressPaths,
): Promise<StartupRecoveryConsent | null> {
  try {
    return ConsentSchema.parse(
      JSON.parse(await readFile(resolve(paths.preferencesRoot, "startup-recovery.json"), "utf8")),
    );
  } catch (error) {
    // Missing, revoked or malformed consent never authorizes process control.
    if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return null;
    throw error;
  }
}

export async function writeStartupRecoveryConsent(
  paths: GoalProgressPaths,
  app: CodexMacosAppIdentity | null,
): Promise<void> {
  const consent =
    app === null
      ? null
      : ConsentSchema.parse({
          schemaVersion: 1,
          appPath: app.realAppPath,
          bundleId: app.bundleId,
          teamId: app.teamId,
          grantedAt: new Date().toISOString(),
        });
  await atomicWriteFile(
    resolve(paths.preferencesRoot, "startup-recovery.json"),
    `${JSON.stringify(consent)}\n`,
  );
}

export function startupRecoveryConsentMatches(
  consent: StartupRecoveryConsent,
  app: CodexMacosAppIdentity,
): boolean {
  return (
    app.signatureValid === true &&
    consent.appPath === app.realAppPath &&
    consent.bundleId === app.bundleId &&
    consent.teamId === app.teamId
  );
}
