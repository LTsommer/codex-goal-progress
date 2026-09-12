import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const output = resolve(root, "dist/claude-marketplace");
await rm(output, { recursive: true, force: true });
const plugin = resolve(output, "plugins/goal-progress");
await mkdir(plugin, { recursive: true });
await cp(resolve(root, "claude-plugin"), plugin, { recursive: true });
await mkdir(resolve(plugin, "skills/track/references"), { recursive: true });
for (const file of ["checklist-and-scope.md"]) {
  await cp(
    resolve(root, "skills/goal-progress/references", file),
    resolve(plugin, "skills/track/references", file),
  );
}
const bundled = await build({
  stdin: {
    contents: `const { runClaudeCli } = require(${JSON.stringify(resolve(root, "packages/claude-code/src/index.ts"))}); runClaudeCli().catch(error => { if (process.argv[2] !== "statusline") { console.error(error.message); process.exitCode = process.argv[2] === "hook" ? 2 : 1; } });`,
    loader: "js",
    resolveDir: root,
  },
  logOverride: { "empty-import-meta": "silent" },
  outfile: resolve(plugin, "bin/goal-progress.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  metafile: true,
});
await chmod(resolve(plugin, "bin/goal-progress"), 0o755);
const { version } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await writeFile(
  resolve(plugin, ".claude-plugin/plugin.json"),
  JSON.stringify(
    {
      name: "goal-progress",
      version,
      description: "Local ordinary-task progress for Claude Code",
      author: { name: "Goal Progress contributors" },
    },
    null,
    2,
  ),
);
await mkdir(resolve(output, ".claude-plugin"), { recursive: true });
await writeFile(
  resolve(output, ".claude-plugin/marketplace.json"),
  JSON.stringify(
    {
      name: "goal-progress-local",
      owner: { name: "Goal Progress" },
      metadata: { description: "Local task progress plugin for Claude Code" },
      plugins: [{ name: "goal-progress", source: "./plugins/goal-progress", version }],
    },
    null,
    2,
  ),
);
await cp(resolve(root, "install-claude.sh"), resolve(output, "install-claude.sh"));
await cp(resolve(root, "docs/CLAUDE-CODE.md"), resolve(output, "README.md"));
await cp(resolve(root, "LICENSE"), resolve(plugin, "LICENSE"));
// Include license files from the exact dependency packages present in the bundle.
const dependencyRoots = new Set();
for (const input of Object.keys(bundled.metafile.inputs)) {
  if (!input.includes("node_modules/")) continue;
  let directory = dirname(resolve(root, input));
  while (directory.includes("node_modules")) {
    try {
      const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
      if (manifest.name && manifest.version) {
        dependencyRoots.add(directory);
        break;
      }
      directory = dirname(directory);
    } catch {
      directory = dirname(directory);
    }
  }
}
const { readdir } = await import("node:fs/promises");
const notices = [];
for (const directory of [...dependencyRoots].sort()) {
  const manifest = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
  const licenses = (await readdir(directory)).filter((file) =>
    /^(license|licence|copying|notice)(\..*)?$/i.test(file),
  );
  if (!licenses.length) throw new Error(`Missing bundled dependency license: ${manifest.name}`);
  for (const file of licenses) {
    notices.push(
      `${manifest.name}@${manifest.version}\n${await readFile(resolve(directory, file), "utf8")}`,
    );
  }
}
await writeFile(resolve(plugin, "THIRD_PARTY_NOTICES.txt"), notices.join("\n\n"));
console.log(`Claude marketplace built: ${output}`);
