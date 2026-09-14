import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const linuxSources = [
  "platform/linux/src/cdp-runtime.ts",
  "platform/linux/src/cli.ts",
  "platform/linux/src/desktop-entry.ts",
  "platform/linux/src/runtime.ts",
  "platform/linux/src/source-installation.ts",
  "platform/linux/src/user-session.ts",
];
const macosSources = ["platform/macos/src/source-cdp-policy.ts"];

export function setupPolicySourceFiles(platform = process.platform) {
  return [...(platform === "linux" ? linuxSources : macosSources)];
}

export function setupPolicySha256(sourceRoot, platform = process.platform) {
  const hash = createHash("sha256");
  for (const file of setupPolicySourceFiles(platform)) {
    const bytes = readFileSync(resolve(sourceRoot, file));
    // Keep the existing macOS fingerprint byte-for-byte compatible. Linux setup
    // spans several modules; include unambiguous file names and lengths in order.
    if (platform === "linux") hash.update(`${file}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
