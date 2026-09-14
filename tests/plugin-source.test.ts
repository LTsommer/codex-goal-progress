import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { setupPolicySha256, setupPolicySourceFiles } from "../runtime/setup-policy.mjs";
import { buildPluginPackage } from "../scripts/build_plugin_package.mjs";

async function sourceFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else assert.fail(`Unexpected source entry: ${path}`);
  }
  return files.sort();
}

test("generated plugin has complete canonical source and builds Linux CLI without checkout layout", {
  skip: process.platform !== "linux",
}, async () => {
  const temporary = await mkdtemp("/tmp/gp-packaged-source-");
  try {
    const plugin = await buildPluginPackage({ outputRoot: join(temporary, "plugin") });
    const packagedSource = join(plugin, "runtime/source");
    await assert.rejects(readdir(join(plugin, "packages")), { code: "ENOENT" });
    for (const directory of ["packages", "platform", "hooks"]) {
      const expected = await sourceFiles(directory);
      assert.deepEqual(await sourceFiles(join(packagedSource, directory)), expected);
      for (const file of expected) {
        assert.deepEqual(
          await readFile(join(packagedSource, directory, file)),
          await readFile(join(directory, file)),
        );
      }
    }
    for (const file of setupPolicySourceFiles("linux")) await readFile(join(packagedSource, file));
    // Reproduce build staging using the already locked local dependencies. No
    // network install, user config, daemon, model request or desktop is involved.
    const stage = join(temporary, "build-stage");
    await cp(join(plugin, "runtime"), stage, { recursive: true });
    await symlink(resolve("node_modules"), join(stage, "node_modules"), "dir");
    const output = join(temporary, "helper");
    const build = spawnSync(
      process.execPath,
      [join(stage, "build-runtime.mjs"), "--source", join(stage, "source"), "--output", output],
      { cwd: stage, encoding: "utf8", timeout: 30000 },
    );
    assert.equal(build.status, 0, build.stderr);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.setupPolicySha256, setupPolicySha256(packagedSource, "linux"));
    const cli = spawnSync(
      process.execPath,
      [join(output, "bin/goal-progress.cjs"), "__read-only-cli-check"],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /GOAL_PROGRESS_COMMAND_INVALID: __read-only-cli-check/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
