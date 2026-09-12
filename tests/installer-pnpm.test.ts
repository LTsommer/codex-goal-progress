import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const helper = resolve("scripts/ensure-local-pnpm.mjs");

test("installer pnpm check is read-only; prepare pins private dependency and validates it", () => {
  const root = mkdtempSync(join(tmpdir(), "gp-pnpm-test-"));
  try {
    const bins = join(root, "bin");
    mkdirSync(bins);
    const manifest = join(root, "package.json");
    writeFileSync(manifest, JSON.stringify({ packageManager: "pnpm@11.19.0" }));
    const data = join(root, "data");
    const env = { ...process.env, PATH: bins, GOAL_PROGRESS_PNPM: "" };
    const run = (mode: string) =>
      spawnSync(process.execPath, [helper, mode, manifest, data], { env, encoding: "utf8" });
    assert.equal(run("check").status, 1);
    assert.equal(existsSync(data), false);
    assert.equal(run("prepare").status, 1);
    assert.equal(existsSync(data), false);
    const npm = join(bins, "npm");
    writeFileSync(npm, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    assert.equal(run("prepare").status, 1);
    const log = join(root, "args.json");
    writeFileSync(
      npm,
      `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(args));const prefix=args[args.indexOf('--prefix')+1];const bin=path.join(prefix,'node_modules','.bin','pnpm');fs.mkdirSync(path.dirname(bin),{recursive:true});fs.writeFileSync(bin,'#!/bin/sh\\nprintf "11.19.0\\\\n"\\n',{mode:0o700});\n`,
      { mode: 0o700 },
    );
    const prepared = run("prepare");
    assert.equal(prepared.status, 0, prepared.stderr);
    const privateBin = join(data, "tooling/pnpm-11.19.0/node_modules/.bin/pnpm");
    assert.equal(prepared.stdout.trim(), privateBin);
    const args = JSON.parse(readFileSync(log, "utf8"));
    assert.ok(args.includes("pnpm@11.19.0"));
    assert.ok(args.includes("--ignore-scripts"));
    assert.ok(!args.includes("--global"));
    assert.equal(args[args.indexOf("--prefix") + 1], join(data, "tooling/pnpm-11.19.0"));
    writeFileSync(npm, "#!/bin/sh\nexit 1\n");
    assert.equal(run("check").status, 0);
    assert.equal(run("prepare").status, 0);
    rmSync(data, { recursive: true });
    const available = join(bins, "pnpm");
    writeFileSync(available, '#!/bin/sh\nprintf "11.19.0\\n"\n', { mode: 0o700 });
    assert.equal(run("prepare").stdout.trim(), available);
    assert.equal(existsSync(data), false);
    writeFileSync(available, '#!/bin/sh\nprintf "11.18.0\\n"\n');
    assert.equal(run("check").status, 1);
    assert.equal(existsSync(data), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
