import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { setupPolicySha256, setupPolicySourceFiles } from "../runtime/setup-policy.mjs";

test("Linux setup fingerprint covers every runtime module while macOS retains its existing fingerprint", async () => {
  const root = await mkdtemp("/tmp/gp-policy-");
  try {
    const files = setupPolicySourceFiles("linux");
    const actualModules = (await readdir("platform/linux/src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => `platform/linux/src/${file}`)
      .sort();
    assert.deepEqual(files, actualModules);
    for (const file of [...files, ...setupPolicySourceFiles("darwin")]) {
      await mkdir(join(root, file, ".."), { recursive: true });
      await cp(file, join(root, file));
    }
    const original = setupPolicySha256(root, "linux");
    const macosOriginal = setupPolicySha256(root, "darwin");
    for (const file of files) {
      const bytes = await readFile(join(root, file));
      await appendFile(join(root, file), "\n// policy changed\n");
      assert.notEqual(setupPolicySha256(root, "linux"), original, file);
      assert.equal(setupPolicySha256(root, "darwin"), macosOriginal, file);
      await writeFile(join(root, file), bytes);
    }
    assert.equal(setupPolicySha256(root, "linux"), original);
    assert.equal(
      setupPolicySha256(root, "darwin"),
      createHash("sha256")
        .update(await readFile("platform/macos/src/source-cdp-policy.ts"))
        .digest("hex"),
    );
    await rm(join(root, files[0]));
    assert.throws(() => setupPolicySha256(root, "linux"), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
