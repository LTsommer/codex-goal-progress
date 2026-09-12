import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("Claude installer check does not register plugins or change settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "gp-claude-install-"));
  try {
    const repo = join(root, "repo");
    const artifact = join(repo, "dist/claude-marketplace/plugins/goal-progress/bin");
    await mkdir(artifact, { recursive: true });
    await copyFile(resolve("install-claude.sh"), join(repo, "install-claude.sh"));
    await writeFile(join(artifact, "goal-progress.cjs"), 'process.stdout.write("progress")');
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "claude"), "#!/bin/sh\necho unexpected-command >&2\nexit 99\n", {
      mode: 0o755,
    });
    const config = join(root, "config");
    await mkdir(config);
    const settings =
      '{"env":{"KEEP":"yes"},"statusLine":{"type":"command","command":"printf original"}}';
    await writeFile(join(config, "settings.json"), settings);
    const output = execFileSync("sh", [join(repo, "install-claude.sh"), "--check"], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config },
      encoding: "utf8",
    });
    assert.match(output, /No settings changed/);
    assert.equal(await readFile(join(config, "settings.json"), "utf8"), settings);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installer preserves command text, stdin, unrelated settings and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "gp-claude-compose-"));
  try {
    const repo = join(root, "repo ' quoted");
    const artifact = join(repo, "dist/claude-marketplace/plugins/goal-progress/bin");
    await mkdir(artifact, { recursive: true });
    await copyFile(resolve("install-claude.sh"), join(repo, "install-claude.sh"));
    await writeFile(join(artifact, "goal-progress.cjs"), 'process.stdout.write("progress")');
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const config = join(root, "config ' quoted");
    await mkdir(config);
    const original = 'printf "original:"; cat';
    await writeFile(
      join(config, "settings.json"),
      JSON.stringify({
        env: { KEEP: "yes" },
        statusLine: { type: "command", command: original, padding: 2 },
      }),
    );
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: config };
    for (let i = 0; i < 2; i++) execFileSync("sh", [join(repo, "install-claude.sh")], { env });
    const settings = JSON.parse(await readFile(join(config, "settings.json"), "utf8"));
    assert.equal(settings.env.KEEP, "yes");
    assert.equal(settings.statusLine.padding, 2);
    const metadata = JSON.parse(
      await readFile(join(config, "goal-progress-statusline/config.json"), "utf8"),
    );
    assert.equal(metadata.previous.command, original);
    const output = execFileSync("sh", ["-c", settings.statusLine.command], {
      input: '{"session_id":"one"}',
      encoding: "utf8",
    });
    assert.equal(output, 'original:{"session_id":"one"}\nprogress');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("backup precedes Claude mutations and no-statusline preserves non-command settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "gp-claude-backup-"));
  try {
    const repo = join(root, "repo");
    const artifact = join(repo, "dist/claude-marketplace/plugins/goal-progress/bin");
    await mkdir(artifact, { recursive: true });
    await copyFile(resolve("install-claude.sh"), join(repo, "install-claude.sh"));
    await writeFile(join(artifact, "goal-progress.cjs"), "");
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(
      join(bin, "claude"),
      `#!/bin/sh
node - <<'NODE'
const fs=require('node:fs'); const path=require('node:path');const root=process.env.CLAUDE_CONFIG_DIR;
const states=fs.readdirSync(root).filter(x=>x.endsWith('.state.json'));
if(states.length!==1)process.exit(98);
const state=JSON.parse(fs.readFileSync(path.join(root,states[0]),'utf8'));
if(state.existed && fs.readFileSync(state.backup,'utf8')!==process.env.ORIGINAL_SETTINGS)process.exit(97);
const file=path.join(root,'settings.json');const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};s.enabledPlugins={'goal-progress@goal-progress-local':true};fs.writeFileSync(file,JSON.stringify(s));
NODE
`,
      { mode: 0o755 },
    );
    for (const existed of [true, false]) {
      const config = join(root, String(existed));
      await mkdir(config);
      const original = JSON.stringify({
        statusLine: { type: "future-provider", value: "untouched" },
        env: { KEEP: "yes" },
      });
      if (existed) await writeFile(join(config, "settings.json"), original);
      execFileSync("sh", [join(repo, "install-claude.sh"), "--no-statusline"], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_CONFIG_DIR: config,
          ORIGINAL_SETTINGS: original,
        },
      });
      const settings = JSON.parse(await readFile(join(config, "settings.json"), "utf8"));
      if (existed)
        assert.deepEqual(settings.statusLine, { type: "future-provider", value: "untouched" });
      const files = await (await import("node:fs/promises")).readdir(config);
      const stateFile = files.find((x) => x.endsWith(".state.json"));
      assert.ok(stateFile);
      const state = JSON.parse(await readFile(join(config, stateFile), "utf8"));
      assert.equal(state.existed, existed);
      if (!existed) assert.equal(state.backup, null);
      assert.ok(!files.includes("goal-progress-statusline"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
