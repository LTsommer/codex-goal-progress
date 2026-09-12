import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { GoalProgressHelper } from "../packages/host/src/index.js";
import {
  type GoalProgressStartupListener,
  MacosCodexStartupEventSchema,
  MacosCodexStartupResponseSchema,
  MacosStartupHandoffController,
} from "../packages/host/src/startup-listener.js";
import { resolveGoalProgressPaths } from "../packages/store/src/index.js";
import type { CodexMacosAppIdentity } from "../platform/macos/src/app-discovery.js";
import {
  readStartupRecoveryConsent,
  writeStartupRecoveryConsent,
} from "../platform/macos/src/startup-consent.js";

for (const sourcePluginRuntime of [true, false]) {
  for (const consentEnabled of [true, false]) {
    test(`startup listener respects source restart boundary: source=${sourcePluginRuntime}, consent=${consentEnabled}`, async () => {
      const root = await mkdtemp("/tmp/gp-start-");
      const paths = resolveGoalProgressPaths({ root });
      let handler: Parameters<GoalProgressStartupListener["start"]>[0] | undefined;
      let handoffs = 0;
      const app = {
        realAppPath: "/Applications/Codex.app",
        bundleId: "com.openai.codex",
        teamId: "2DC432GLL2",
        signatureValid: true,
      } as CodexMacosAppIdentity;
      if (consentEnabled) await writeStartupRecoveryConsent(paths, app);
      const startupHandoff = new MacosStartupHandoffController({ paths });
      // Replace the real controller entry point: no process inspection or signals are permitted.
      startupHandoff.handle = async (event, recoverable, context) => {
        assert.equal(recoverable, false, "Empty store must not prevent authorized recovery");
        assert.equal(context?.recoveryConsent !== undefined, sourcePluginRuntime && consentEnabled);
        handoffs++;
        return { schemaVersion: 1, pid: event.pid, action: "continue", code: "TEST_HANDOFF" };
      };
      const helper = new GoalProgressHelper({
        paths,
        sourcePluginRuntime,
        startupHandoff,
        startupListener: {
          start: (callback) => {
            handler = callback;
          },
          health: () => ({ running: true, ready: true, pid: 123, pendingPid: null }),
          isPending: () => true,
          waitUntilReady: async () => true,
          stop: async () => {},
        },
        visibleThreadRecoveryDelaysMs: [],
        viewModelSink: { clear: async () => {}, publish: async () => {} },
      });
      try {
        await helper.start();
        assert.ok(handler, "Helper must register the actual startup listener handler");
        const event = MacosCodexStartupEventSchema.parse({
          schemaVersion: 1,
          event: "codex.willLaunch",
          pid: 12345,
          bundleId: "com.openai.codex",
          appPath: "/Applications/Codex.app",
          executablePath: "/Applications/Codex.app/Contents/MacOS/Codex",
          launchedAt: new Date().toISOString(),
          deadlineAtMs: Date.now() + 5000,
        });
        // Repeated launch notifications must not turn a source Helper into a restart loop.
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = MacosCodexStartupResponseSchema.parse(await handler(event));
          assert.deepEqual(response, {
            schemaVersion: 1,
            pid: event.pid,
            action: "continue",
            code: sourcePluginRuntime && !consentEnabled ? "RESTART_REQUIRED" : "TEST_HANDOFF",
          });
        }
        assert.equal(handoffs, sourcePluginRuntime && !consentEnabled ? 0 : 3);
      } finally {
        await helper.stop();
        await rm(root, { recursive: true, force: true });
      }
    });
  }
}

test("persistent consent defaults off and revocation or malformed state cannot authorize", async () => {
  const root = await mkdtemp("/tmp/gp-consent-");
  const paths = resolveGoalProgressPaths({ root });
  try {
    assert.equal(await readStartupRecoveryConsent(paths), null);
    const app = {
      realAppPath: "/Applications/Codex.app",
      bundleId: "com.openai.codex",
      teamId: "2DC432GLL2",
    } as CodexMacosAppIdentity;
    await writeStartupRecoveryConsent(paths, app);
    assert.equal((await readStartupRecoveryConsent(paths))?.appPath, app.realAppPath);
    await writeStartupRecoveryConsent(paths, null);
    assert.equal(await readStartupRecoveryConsent(paths), null);
    await writeFile(`${paths.preferencesRoot}/startup-recovery.json`, "{broken");
    assert.equal(await readStartupRecoveryConsent(paths), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authorized startup still enforces deadline and inspected application identity", async () => {
  const root = await mkdtemp("/tmp/gp-boundary-");
  const paths = resolveGoalProgressPaths({ root });
  const now = Date.now();
  const event = MacosCodexStartupEventSchema.parse({
    schemaVersion: 1,
    event: "codex.willLaunch",
    pid: 12345,
    bundleId: "com.openai.codex",
    appPath: "/Applications/Codex.app",
    executablePath: "/Applications/Codex.app/Contents/MacOS/Codex",
    launchedAt: new Date(now).toISOString(),
    deadlineAtMs: now + 5000,
  });
  const app = {
    realAppPath: event.appPath,
    realExecutablePath: event.executablePath,
    bundleId: event.bundleId,
    teamId: "2DC432GLL2",
    signatureValid: true,
  } as CodexMacosAppIdentity;
  const context = {
    isPending: () => true,
    recoveryConsent: {
      schemaVersion: 1 as const,
      appPath: "/Applications/Other.app",
      bundleId: "com.openai.codex" as const,
      teamId: "2DC432GLL2" as const,
      grantedAt: new Date(now).toISOString(),
    },
  };
  const controller = new MacosStartupHandoffController({
    paths,
    now: () => now,
    inspectTargetProcess: async () => ({
      pid: event.pid,
      parentPid: 1,
      command: event.executablePath,
      startedAt: event.launchedAt,
    }),
    inspectApp: async () => app,
    signalProcess: () => {
      assert.fail("Mismatch must never signal a process");
    },
  });
  try {
    assert.equal(
      (await controller.handle(event, false, context)).code,
      "STARTUP_RECOVERY_CONSENT_MISMATCH",
    );
    assert.equal(
      (await controller.handle(event, false, context)).code,
      "STARTUP_RECOVERY_CONSENT_MISMATCH",
    );
    assert.equal(
      (await controller.handle({ ...event, pid: 12346, deadlineAtMs: now - 1 }, false, context))
        .code,
      "STARTUP_EVENT_EXPIRED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const scenario of [
  "success",
  "expired-during-allocation",
  "launch-failure",
  "existing-instance",
] as const) {
  test(`real startup controller: ${scenario}`, async () => {
    const root = await mkdtemp("/tmp/gp-handoff-");
    const paths = resolveGoalProgressPaths({ root });
    let now = Date.now();
    const event = MacosCodexStartupEventSchema.parse({
      schemaVersion: 1,
      event: "codex.willLaunch",
      pid: 12345,
      bundleId: "com.openai.codex",
      appPath: "/Applications/Codex.app",
      executablePath: "/Applications/Codex.app/Contents/MacOS/Codex",
      launchedAt: new Date(now).toISOString(),
      deadlineAtMs: now + 5000,
    });
    const app = {
      realAppPath: event.appPath,
      realExecutablePath: event.executablePath,
      bundleId: event.bundleId,
      teamId: "2DC432GLL2",
      signatureValid: true,
    } as CodexMacosAppIdentity;
    await writeStartupRecoveryConsent(paths, app);
    const consent = await readStartupRecoveryConsent(paths);
    assert.ok(consent);
    const original = {
      pid: event.pid,
      parentPid: 1,
      command: event.executablePath,
      startedAt: event.launchedAt,
    };
    let originalAlive = true;
    let launches = 0;
    let normalLaunches = 0;
    const signals: string[] = [];
    const command = `${event.executablePath} --remote-debugging-port=45678`;
    const controller = new MacosStartupHandoffController({
      paths,
      now: () => now,
      inspectApp: async () => app,
      inspectTargetProcess: async () => {
        if (!originalAlive) throw new Error("exited");
        return original;
      },
      listMainProcesses: async () =>
        scenario === "existing-instance" ? [{ ...original, pid: 999 }] : [],
      allocatePort: async () => {
        if (scenario === "expired-during-allocation") now = event.deadlineAtMs;
        return 45678;
      },
      signalProcess: (pid, signal) => {
        assert.equal(pid, event.pid);
        signals.push(signal);
        if (signal === "SIGTERM") originalAlive = false;
      },
      launchWithCdp: async () => {
        launches++;
        if (scenario === "launch-failure") throw new Error("launch failed");
        return {
          pid: 22222,
          launchedAt: event.launchedAt,
          processStartedAt: event.launchedAt,
          command,
          args: [],
          child: {} as import("node:child_process").ChildProcess,
        };
      },
      waitForOwnership: async () => ({
        mainProcess: { pid: 22222, parentPid: 1, command, startedAt: event.launchedAt },
        listenerPids: [22222],
        listeners: [],
      }),
      launchNormal: async () => {
        normalLaunches++;
      },
      stopCdpProcess: async () => {
        assert.fail("No owned launched child should be stopped in these scenarios");
      },
    });
    try {
      const context = { isPending: () => true, recoveryConsent: consent };
      const result = await controller.handle(event, false, context);
      assert.deepEqual(
        await controller.handle(event, false, context),
        result,
        "Repeated event must return saved result",
      );
      if (scenario === "success") {
        assert.equal(result.code, "STARTUP_HANDOFF_COMPLETE");
        const { readCodexCdpRuntimeState } = await import("../platform/macos/src/cdp-runtime.js");
        const state = await readCodexCdpRuntimeState(paths.cdpRuntimePath);
        assert.equal(state.mainPid, 22222);
        assert.equal(state.port, 45678);
        assert.equal(state.appPath, app.realAppPath);
        assert.equal(launches, 1);
        assert.equal(normalLaunches, 0);
      } else if (scenario === "launch-failure") {
        assert.equal(result.code, "STARTUP_HANDOFF_FALLBACK_NORMAL");
        assert.equal(launches, 1);
        assert.equal(normalLaunches, 1);
      } else {
        assert.equal(
          result.code,
          scenario === "existing-instance"
            ? "STARTUP_EVENT_EXISTING_INSTANCE"
            : "STARTUP_EVENT_EXPIRED",
        );
        assert.deepEqual(signals, []);
        assert.equal(launches, 0);
        assert.equal(normalLaunches, 0);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
