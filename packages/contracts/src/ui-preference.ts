import { z } from "zod";

export const GOAL_PROGRESS_UI_PREFERENCE_SCHEMA_VERSION = 3 as const;
export const GOAL_PROGRESS_TRACKING_OVERLAY_SCHEMA_VERSION = 1 as const;
export const DEFAULT_GOAL_PROGRESS_FLOATING_X_RATIO = 0.5;

export const GOAL_PROGRESS_ACCENTS = [
  "host",
  "blue",
  "green",
  "yellow",
  "pink",
  "orange",
  "purple",
  "monochrome",
  "rainbow",
] as const;

export type GoalProgressAccent = (typeof GOAL_PROGRESS_ACCENTS)[number];

export const GOAL_PROGRESS_ALLOWED_UI_INTENTS = [
  "setCollapsed",
  "setMotionPaused",
  "setPlacement",
  "setFloatingXRatio",
  "setAccent",
  "requestRetry",
  "requestDetach",
] as const;

export type GoalProgressUiIntentType = (typeof GOAL_PROGRESS_ALLOWED_UI_INTENTS)[number];
export type GoalProgressPlacement = "inline" | "floating";

export const GoalProgressUiPreferenceSchema = z
  .object({
    schemaVersion: z.literal(GOAL_PROGRESS_UI_PREFERENCE_SCHEMA_VERSION),
    collapsed: z.boolean(),
    motionPaused: z.boolean(),
    hidden: z.boolean(),
    placement: z.enum(["inline", "floating"]),
    floatingXRatio: z.number().min(0).max(1),
    accent: z.enum(GOAL_PROGRESS_ACCENTS),
  })
  .strict();

export type GoalProgressUiPreference = z.infer<typeof GoalProgressUiPreferenceSchema>;

const LegacyGoalProgressUiPreferenceV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    collapsed: z.boolean(),
    motionPaused: z.boolean(),
    hidden: z.boolean(),
    placement: z.enum(["inline", "floating"]),
    floatingXRatio: z.number().min(0).max(1),
  })
  .strict();

const LegacyGoalProgressUiPreferenceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    collapsed: z.boolean(),
    motionPaused: z.boolean(),
    hidden: z.boolean(),
  })
  .strict();

export const DEFAULT_GOAL_PROGRESS_UI_PREFERENCE: GoalProgressUiPreference = {
  schemaVersion: GOAL_PROGRESS_UI_PREFERENCE_SCHEMA_VERSION,
  collapsed: false,
  motionPaused: false,
  hidden: false,
  placement: "inline",
  floatingXRatio: DEFAULT_GOAL_PROGRESS_FLOATING_X_RATIO,
  accent: "host",
};

export function migrateGoalProgressUiPreference(input: unknown): GoalProgressUiPreference | null {
  const current = GoalProgressUiPreferenceSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }
  const v2 = LegacyGoalProgressUiPreferenceV2Schema.safeParse(input);
  if (v2.success) {
    return {
      ...v2.data,
      schemaVersion: GOAL_PROGRESS_UI_PREFERENCE_SCHEMA_VERSION,
      accent: "host",
    };
  }
  const v1 = LegacyGoalProgressUiPreferenceV1Schema.safeParse(input);
  if (!v1.success) {
    return null;
  }
  return {
    ...v1.data,
    schemaVersion: GOAL_PROGRESS_UI_PREFERENCE_SCHEMA_VERSION,
    placement: "inline",
    floatingXRatio: DEFAULT_GOAL_PROGRESS_FLOATING_X_RATIO,
    accent: "host",
  };
}

export const GoalProgressTrackingOverlaySchema = z
  .object({
    schemaVersion: z.literal(GOAL_PROGRESS_TRACKING_OVERLAY_SCHEMA_VERSION),
    detached: z.boolean(),
  })
  .strict();

export type GoalProgressTrackingOverlay = z.infer<typeof GoalProgressTrackingOverlaySchema>;

export const DEFAULT_GOAL_PROGRESS_TRACKING_OVERLAY: GoalProgressTrackingOverlay = {
  schemaVersion: GOAL_PROGRESS_TRACKING_OVERLAY_SCHEMA_VERSION,
  detached: false,
};

export const GoalProgressUiIntentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("setCollapsed"),
      collapsed: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("setMotionPaused"),
      motionPaused: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("setPlacement"),
      placement: z.enum(["inline", "floating"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("setFloatingXRatio"),
      floatingXRatio: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("setAccent"),
      accent: z.enum(GOAL_PROGRESS_ACCENTS),
    })
    .strict(),
  z
    .object({
      type: z.literal("requestRetry"),
    })
    .strict(),
  z
    .object({
      type: z.literal("requestDetach"),
    })
    .strict(),
]);

export type GoalProgressUiIntent = z.infer<typeof GoalProgressUiIntentSchema>;

export type GoalProgressUiIntentErrorCode = "UI_INTENT_UNKNOWN" | "UI_INTENT_INVALID";

export type GoalProgressUiIntentResult =
  | { readonly ok: true; readonly intent: GoalProgressUiIntent }
  | {
      readonly ok: false;
      readonly code: GoalProgressUiIntentErrorCode;
      readonly message: string;
    };

export function acceptGoalProgressUiIntent(input: unknown): GoalProgressUiIntentResult {
  if (
    input !== null &&
    typeof input === "object" &&
    "type" in input &&
    typeof input.type === "string" &&
    !(GOAL_PROGRESS_ALLOWED_UI_INTENTS as readonly string[]).includes(input.type)
  ) {
    return {
      ok: false,
      code: "UI_INTENT_UNKNOWN",
      message: `Unknown UI intent: ${input.type}`,
    };
  }
  const parsed = GoalProgressUiIntentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "UI_INTENT_INVALID",
      message: parsed.error.issues[0]?.message ?? "The UI intent is invalid",
    };
  }
  return { ok: true, intent: parsed.data };
}
