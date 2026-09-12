const { createHash } = require("node:crypto");
const { lstat, mkdir } = require("node:fs/promises");
const { dirname, resolve } = require("node:path");

// Shared by bundled Helper clients and the dependency-free source bootstrap.
function resolveHelperSocketPath(root, platform = process.platform, uid = process.getuid?.()) {
  const canonicalRoot = resolve(root);
  const original = resolve(canonicalRoot, "runtime/helper.sock");
  const limit = platform === "darwin" ? 103 : 107;
  if (platform === "win32" || Buffer.byteLength(original, "utf8") <= limit) return original;
  if (!Number.isSafeInteger(uid) || uid < 0) throw new Error("IPC_SOCKET_USER_UNAVAILABLE");
  const key = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 32);
  return resolve(
    platform === "darwin" ? "/private/tmp" : "/tmp",
    `codex-goal-progress-${uid}`,
    `${key}.sock`,
  );
}

async function ensureHelperSocketDirectory(socketPath) {
  const directory = dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.getuid && metadata.uid !== process.getuid()) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(
      "IPC_SOCKET_DIRECTORY_UNSAFE: socket directory must be owned by this user with private permissions",
    );
  }
}

exports.resolveHelperSocketPath = resolveHelperSocketPath;
exports.ensureHelperSocketDirectory = ensureHelperSocketDirectory;
