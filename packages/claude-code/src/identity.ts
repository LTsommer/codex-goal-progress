import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

export const ClaudeToolNameSchema = z
  .string()
  .regex(
    /^mcp__plugin_goal-progress_goal_progress__goal_progress_(activate|initialize|get|explore|update|rescope|set_phase)$/,
  );
export const ClaudeProofSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1).max(256),
    cwd: z.string().refine(isAbsolute),
    toolName: ClaudeToolNameSchema,
    toolUseId: z.string().min(1).max(256),
    promptId: z.string().min(1).max(256).optional(),
    issuedAtMs: z.number().int().nonnegative(),
    nonce: z.string().uuid(),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
type Proof = z.infer<typeof ClaudeProofSchema>;
export interface ClaudeAuthorizedIdentity {
  sessionId: string;
  cwd: string;
  toolUseId: string;
  promptId?: string;
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("CLAUDE_IDENTITY_DIRECTORY_UNSAFE");
  await chmod(path, 0o700);
}

async function key(dataRoot: string, create: boolean): Promise<Buffer> {
  const directory = join(dataRoot, "identity");
  if (create) {
    await privateDirectory(dataRoot);
    await privateDirectory(directory);
  }
  const path = join(directory, "proof.key");
  if (create) {
    const temporary = join(directory, `key-${randomUUID()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(randomBytes(32));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await unlink(temporary);
    }
  }
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("CLAUDE_IDENTITY_KEY_UNSAFE");
  const value = await readFile(path);
  if (value.length !== 32) throw new Error("CLAUDE_IDENTITY_KEY_INVALID");
  return value;
}
function payload(proof: Omit<Proof, "signature">): string {
  return JSON.stringify([
    proof.version,
    proof.sessionId,
    proof.cwd,
    proof.toolName,
    proof.toolUseId,
    proof.promptId ?? null,
    proof.issuedAtMs,
    proof.nonce,
  ]);
}
export async function issueClaudeProof(
  identity: ClaudeAuthorizedIdentity,
  toolName: string,
  dataRoot: string,
): Promise<Proof> {
  const unsigned = {
    ...identity,
    version: 1 as const,
    toolName: ClaudeToolNameSchema.parse(toolName),
    issuedAtMs: Date.now(),
    nonce: randomUUID(),
  };
  return ClaudeProofSchema.parse({
    ...unsigned,
    signature: createHmac("sha256", await key(dataRoot, true))
      .update(payload(unsigned))
      .digest("hex"),
  });
}

export class ClaudeIdentityVerifier {
  #bound: { sessionId: string; cwd: string } | undefined;
  constructor(private readonly dataRoot: string) {}
  async authorize(toolName: string, input: unknown): Promise<ClaudeAuthorizedIdentity> {
    const proof = ClaudeProofSchema.parse(input);
    if (
      proof.toolName !== toolName ||
      proof.issuedAtMs > Date.now() + 5_000 ||
      Date.now() - proof.issuedAtMs > 300_000
    )
      throw new Error("CLAUDE_PROOF_EXPIRED_OR_WRONG_TOOL");
    const expected = createHmac("sha256", await key(this.dataRoot, false))
      .update(payload(proof))
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(proof.signature, "hex")))
      throw new Error("CLAUDE_PROOF_INVALID");
    // Bind before the first await after verification so concurrent requests cannot switch sessions.
    if (this.#bound && (this.#bound.sessionId !== proof.sessionId || this.#bound.cwd !== proof.cwd))
      throw new Error("CLAUDE_SESSION_MISMATCH");
    this.#bound = { sessionId: proof.sessionId, cwd: proof.cwd };
    const consumed = join(this.dataRoot, "identity", "consumed");
    await privateDirectory(consumed);
    const handle = await open(join(consumed, proof.nonce), "wx", 0o600).catch(() => {
      throw new Error("CLAUDE_PROOF_REPLAY_OR_STORAGE_ERROR");
    });
    try {
      await handle.writeFile(String(proof.issuedAtMs));
      await handle.sync();
    } finally {
      await handle.close();
    }
    return {
      sessionId: proof.sessionId,
      cwd: proof.cwd,
      toolUseId: proof.toolUseId,
      ...(proof.promptId ? { promptId: proof.promptId } : {}),
    };
  }
}
