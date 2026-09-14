import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { decideCodexCdpRestart } from "../platform/macos/src/cdp-controller.js";
import { setupPolicySha256, setupPolicySourceFiles } from "../runtime/setup-policy.mjs";
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
    await mkdir(join(fixture, "packages/store/src"), { recursive: true });
    await cp(
      "packages/store/src/socket-path.cjs",
      join(fixture, "packages/store/src/socket-path.cjs"),
    );
    for (const file of setupPolicySourceFiles()) {
      await mkdir(join(fixture, file, ".."), { recursive: true });
      await cp(file, join(fixture, file));
    }
    await mkdir(join(fixture, "hooks/src"), { recursive: true });
    await mkdir(join(runtime, "source"), { recursive: true });
    await cp(join(fixture, "packages"), join(runtime, "source/packages"), { recursive: true });
    await cp(join(fixture, "platform"), join(runtime, "source/platform"), { recursive: true });
    // A stale packaged mirror must not override the checkout source fingerprint.
    await writeFile(join(runtime, "source", setupPolicySourceFiles()[0]), "stale packaged policy");
    await cp("runtime/setup-policy.mjs", join(runtime, "setup-policy.mjs"));
    await cp("runtime/runtime-lock.mjs", join(runtime, "runtime-lock.mjs"));
    await cp("runtime/bootstrap.mjs", join(runtime, "bootstrap.mjs"));
    const data = join(fixture, "data");
    const bin = join(data, "source-runtime/versions/0.3.7/bin");
    await mkdir(bin, { recursive: true });
    const log = join(fixture, "calls.txt");
    await writeFile(
      join(bin, "goal-progress"),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$GP_TEST_CALLS"',
        'if [ "$1" = __source-runtime-ensure ] && [ -n "$GP_TEST_SETUP_RESULT" ]; then',
        '  printf "%s\\n" "$GP_TEST_SETUP_RESULT"; exit "$GP_TEST_SETUP_EXIT"',
        'fi',
        'if [ "$1" = mcp-server ] && [ -n "$GP_TEST_MCP_ENTRY" ]; then',
        '  exec "$GP_TEST_NODE" --import tsx "$GP_TEST_MCP_ENTRY"',
        'fi',
        '',
      ].join("\n"),
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
          join(fixture, "packages/store/src/socket-path.cjs"),
        ),
        setupPolicySha256: setupPolicySha256(fixture),
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
    // Run the actual MCP stdio entry after bootstrap accepts the setup result.
    // UI absence is reported separately; a failed core setup must still block MCP.
    for (const coreReady of [true, false]) {
      await writeFile(log, "");
      const setup = {
        ok: coreReady,
        code: coreReady ? "SETUP_CORE_READY" : "LINUX_HELPER_NOT_READY",
        details: { helperReady: coreReady, cdpReady: false, uiError: "ENOENT: cdp.json" },
      };
      const result = spawnSync(process.execPath, [join(runtime, "bootstrap.mjs"), "mcp-server"], {
        env: {
          ...env,
          GP_TEST_SETUP_RESULT: JSON.stringify(setup),
          GP_TEST_SETUP_EXIT: coreReady ? "0" : "1",
          GP_TEST_NODE: process.execPath,
          GP_TEST_MCP_ENTRY: resolve("packages/mcp/src/index.ts"),
        },
        input: `${JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bootstrap-test", version: "1" } },
        })}\n`,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.equal(result.status, coreReady ? 0 : 1, result.stderr);
      assert.equal(await readFile(log, "utf8"), coreReady ? "__source-runtime-ensure\nmcp-server\n" : "__source-runtime-ensure\n");
      if (coreReady) {
        const replies = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
        assert.equal(replies.length, 1, "setup JSON must not corrupt the MCP stdio stream");
        assert.equal(replies[0].id, 1);
        assert.equal(replies[0].result.serverInfo.name, "codex-goal-progress");
      } else {
        assert.match(result.stderr, /GOAL_PROGRESS_SOURCE_SETUP_FAILED/u);
        assert.equal(result.stdout, "");
      }
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
