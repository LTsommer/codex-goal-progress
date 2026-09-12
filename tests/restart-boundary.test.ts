import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { decideCodexCdpRestart } from "../platform/macos/src/cdp-controller.js";
import { ensureSourceCdp } from "../platform/macos/src/source-cdp-policy.js";

test("automatic setup cannot schedule restart for missing CDP; explicit setup may", async () => {
  const requests: boolean[] = [];
  const cdp = {
    verify: async () => false,
    ensure: async (restart: boolean) => {
      requests.push(restart);
      return true;
    },
  };
  assert.equal(await ensureSourceCdp(cdp), false);
  assert.equal(await ensureSourceCdp(cdp, false), false);
  assert.deepEqual(requests, []);
  assert.equal(await ensureSourceCdp(cdp, true), true);
  assert.deepEqual(requests, [true]);
  assert.equal(await ensureSourceCdp({ ...cdp, verify: async () => true }, true), false);
  assert.deepEqual(requests, [true]);
  assert.equal(
    decideCodexCdpRestart({ cdpReady: false, restartRequested: false, handoffProcess: false }),
    "skip",
  );
});

test("core setup does not inspect UI identity, while explicit repair preserves identity failures", async () => {
  let verifies = 0;
  const cdp = {
    verify: async () => {
      verifies++;
      throw new Error("GOAL_PROGRESS_CDP_RUNTIME_APP_MISMATCH");
    },
    ensure: async () => {
      throw new Error("must not restart an unverified application");
    },
  };
  assert.equal(await ensureSourceCdp(cdp), false);
  assert.equal(verifies, 0);
  await assert.rejects(ensureSourceCdp(cdp, true), /GOAL_PROGRESS_CDP_RUNTIME_APP_MISMATCH/);
  assert.equal(verifies, 1);
});

test("actual bootstrap sends restart approval only for explicitly flagged prepare/repair", async () => {
  const fixture = await mkdtemp("/tmp/gp-bootstrap-");
  try {
    const runtime = join(fixture, "runtime");
    await mkdir(join(fixture, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(fixture, ".codex-plugin/plugin.json"),
      JSON.stringify({ name: "codex-goal-progress", version: "0.3.7" }),
    );
    await mkdir(join(runtime, "source/packages/store/src"), { recursive: true });
    await mkdir(join(runtime, "source/platform/macos/src"), { recursive: true });
    await cp(
      "packages/store/src/socket-path.cjs",
      join(runtime, "source/packages/store/src/socket-path.cjs"),
    );
    await cp(
      "platform/macos/src/source-cdp-policy.ts",
      join(runtime, "source/platform/macos/src/source-cdp-policy.ts"),
    );
    await cp("runtime/runtime-lock.mjs", join(runtime, "runtime-lock.mjs"));
    await cp("runtime/bootstrap.mjs", join(runtime, "bootstrap.mjs"));
    const data = join(fixture, "data");
    const bin = join(data, "source-runtime/versions/0.3.7/bin");
    await mkdir(bin, { recursive: true });
    const log = join(fixture, "calls.txt");
    await writeFile(
      join(bin, "goal-progress"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GP_TEST_CALLS"\n',
      { mode: 0o700 },
    );
    await writeFile(join(bin, "goal-progress.cjs"), "// fixture helper\n");
    await writeFile(join(bin, "goal-progress-startup-listener"), "#!/bin/sh\n", { mode: 0o700 });
    const digest = async (path: string) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
    const files: Record<string, { path: string; bytes: number; sha256: string }> = {};
    for (const name of ["goal-progress", "goal-progress.cjs", "goal-progress-startup-listener"]) {
      const bytes = await readFile(join(bin, name));
      files[`bin/${name}`] = {
        path: `bin/${name}`,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
    await writeFile(
      join(bin, "../manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        releaseVersion: "0.3.7",
        files,
        socketPolicySha256: await digest(
          join(runtime, "source/packages/store/src/socket-path.cjs"),
        ),
        setupPolicySha256: await digest(
          join(runtime, "source/platform/macos/src/source-cdp-policy.ts"),
        ),
      }),
    );
    const env = { ...process.env, GOAL_PROGRESS_PLUGIN_DATA: data, GP_TEST_CALLS: log };
    for (const [args, expected] of [
      [["mcp-server"], "__source-runtime-ensure\nmcp-server\n"],
      [["mcp-server", "--restart-codex"], "__source-runtime-ensure\nmcp-server\n"],
      [["prepare"], "__source-runtime-ensure\n"],
      [["prepare", "--restart-codex"], "__source-runtime-ensure --restart-codex\n"],
      [["repair"], "__source-runtime-ensure\nverify --json\n"],
      [["startup-recovery", "status"], "startup-recovery status\n"],
      [["startup-recovery", "disable"], "startup-recovery disable\n"],
    ] as const) {
      await writeFile(log, "");
      const result = spawnSync(process.execPath, [join(runtime, "bootstrap.mjs"), ...args], {
        env,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(log, "utf8"), expected);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
