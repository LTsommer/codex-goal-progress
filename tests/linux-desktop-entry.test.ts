import assert from "node:assert/strict";
import test from "node:test";
import { waitForLinuxRenderer } from "../platform/linux/src/cdp-runtime.js";
import {
  createManagedDesktopEntry,
  parseLinuxLaunchArguments,
} from "../platform/linux/src/desktop-entry.js";
import {
  type LinuxCdpRuntimeState,
  type LinuxHelperSession,
  linuxHelperSessionMatches,
} from "../platform/linux/src/runtime.js";

test("helper reuse requires the same desktop launch and the same running helper", () => {
  const session: LinuxHelperSession = {
    schemaVersion: 1,
    pid: 42,
    processStartTicks: "123",
    launchId: "launch-one",
    bundleDigest: "bundle-one",
  };
  assert.equal(linuxHelperSessionMatches(session, { ...session }), true);
  assert.equal(linuxHelperSessionMatches(null, session), false);
  for (const change of [
    { pid: 43 },
    { processStartTicks: "124" },
    { launchId: "launch-two" },
    { bundleDigest: "bundle-two" },
  ])
    assert.equal(linuxHelperSessionMatches(session, { ...session, ...change }), false);
});

test("normal desktop override preserves metadata, URL placeholder and action groups", () => {
  const original =
    "[Desktop Entry]\nName=ChatGPT\nIcon=chatgpt\nExec=chatgpt %U\nMimeType=x-scheme-handler/codex;\n[Desktop Action help]\nExec=chatgpt-help\n";
  const managed = createManagedDesktopEntry(original, "/tmp/path with spaces/launcher", "# owner");
  assert.equal(
    managed,
    `# owner\n${original.replace("Exec=chatgpt %U", 'Exec="/tmp/path with spaces/launcher" %U')}`,
  );
  assert.throws(
    () =>
      createManagedDesktopEntry(
        original.replace("chatgpt %U", "chatgpt --custom %U"),
        "/tmp/launcher",
        "# owner",
      ),
    /EXEC_UNSUPPORTED/u,
  );
});
test("desktop parameters remain data and cannot become launcher control options", () => {
  assert.deepEqual(
    parseLinuxLaunchArguments([
      "--",
      "codex://thread/123",
      "/tmp/my file.csv",
      "https://example.org/a?x=1",
    ]),
    {
      restartCodex: false,
      args: ["codex://thread/123", "/tmp/my file.csv", "https://example.org/a?x=1"],
    },
  );
  assert.deepEqual(parseLinuxLaunchArguments(["--"]), { restartCodex: false, args: [] });
  assert.deepEqual(parseLinuxLaunchArguments(["--restart-codex"]), {
    restartCodex: true,
    args: [],
  });
  for (const input of [
    ["--unknown"],
    ["--", "--restart-codex"],
    ["--", "--user-data-dir=/tmp/other"],
    ["--restart-codex", "--restart-codex"],
  ])
    assert.throws(() => parseLinuxLaunchArguments(input));
});
test("renderer startup retries only absent page, revalidating process ownership", async () => {
  const state = { port: 12345 } as LinuxCdpRuntimeState;
  let inspections = 0;
  let discoveries = 0;
  const inspect = async () => {
    inspections++;
    return {} as Awaited<
      ReturnType<typeof import("../platform/linux/src/runtime.js").verifyLinuxCdpRuntime>
    >;
  };
  const discover = async () => {
    discoveries++;
    if (discoveries === 1) throw new Error("GOAL_PROGRESS_CDP_APP_RENDERER_NOT_FOUND");
    return { targets: [] } as Awaited<
      ReturnType<typeof import("../packages/codex-adapter/src/cdp.js").discoverCodexCdp>
    >;
  };
  await waitForLinuxRenderer(state, { inspect, discover, sleep: async () => undefined });
  assert.equal(inspections, 2);
  assert.equal(discoveries, 2);
  await assert.rejects(
    waitForLinuxRenderer(state, {
      inspect: async () => {
        throw new Error("LINUX_CDP_PROCESS_MISMATCH");
      },
      discover,
    }),
    /PROCESS_MISMATCH/u,
  );
  assert.equal(discoveries, 2);
  await assert.rejects(
    waitForLinuxRenderer(state, {
      inspect,
      discover: async () => {
        throw new Error("GOAL_PROGRESS_CDP_UNSAFE_WEBSOCKET_URL");
      },
    }),
    /UNSAFE_WEBSOCKET/u,
  );
  await assert.rejects(
    waitForLinuxRenderer(state, {
      inspect,
      timeoutMs: 0,
      discover: async () => {
        throw new Error("GOAL_PROGRESS_CDP_APP_RENDERER_NOT_FOUND");
      },
    }),
    /LINUX_RENDERER_START_TIMEOUT/u,
  );
});
