import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGoalProgressUiIntent,
  migrateGoalProgressUiPreference,
} from "../packages/contracts/src/ui-preference.js";
import { GOAL_PROGRESS_SET_ACCENT_EVENT } from "../packages/contracts/src/renderer-events.js";
import { parseSidecarUiIntent } from "../packages/codex-adapter/src/sidecar-ui-intent-adapter.js";

test("migrates existing UI preferences to the host accent", () => {
  assert.deepEqual(
    migrateGoalProgressUiPreference({
      schemaVersion: 2,
      collapsed: true,
      motionPaused: false,
      hidden: false,
      placement: "floating",
      floatingXRatio: 0.25,
    }),
    {
      schemaVersion: 3,
      collapsed: true,
      motionPaused: false,
      hidden: false,
      placement: "floating",
      floatingXRatio: 0.25,
      accent: "host",
    },
  );
});

test("accepts only the supported accent intents", () => {
  assert.deepEqual(acceptGoalProgressUiIntent({ type: "setAccent", accent: "rainbow" }), {
    ok: true,
    intent: { type: "setAccent", accent: "rainbow" },
  });
  const rejected = acceptGoalProgressUiIntent({ type: "setAccent", accent: "red" });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.code, "UI_INTENT_INVALID");
  }
});

test("parses a supported accent event and rejects an unsupported value", () => {
  assert.deepEqual(
    parseSidecarUiIntent({
      type: GOAL_PROGRESS_SET_ACCENT_EVENT,
      detail: { accent: "purple" },
    } as Event),
    { intent: { type: "setAccent", accent: "purple" } },
  );
  assert.equal(
    parseSidecarUiIntent({
      type: GOAL_PROGRESS_SET_ACCENT_EVENT,
      detail: { accent: "red" },
    } as Event),
    null,
  );
});
