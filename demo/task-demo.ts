import "../packages/renderer/src/index.js";
import { macosGoalRowV1Locator } from "../packages/codex-adapter/src/anchor-adapter.js";
import { SidecarMountController } from "../packages/codex-adapter/src/sidecar-mount.js";
import { DEFAULT_GOAL_PROGRESS_UI_PREFERENCE } from "../packages/contracts/src/index.js";

import { currentTaskFixture, glassFixture, nativeFixture, taskFixture } from "./task-fixtures.js";

// Preview preferences stay in memory; the installed Helper owns persistence.
let preference = { ...DEFAULT_GOAL_PROGRESS_UI_PREFERENCE };
const controller = new SidecarMountController(document, {
  nativeGoalLocator: macosGoalRowV1Locator,
  onUiIntent: (intent) => {
    if (intent.type === "setAccent") preference = { ...preference, accent: intent.accent };
    if (intent.type === "setCollapsed") preference = { ...preference, collapsed: intent.collapsed };
    if (intent.type === "setMotionPaused")
      preference = { ...preference, motionPaused: intent.motionPaused };
    if (intent.type === "setPlacement") preference = { ...preference, placement: intent.placement };
    if (intent.type === "setFloatingXRatio")
      preference = { ...preference, floatingXRatio: intent.floatingXRatio };
  },
});
function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing demo element: ${selector}`);
  return element;
}
const select = requiredElement<HTMLSelectElement>("#mode");
const theme = requiredElement<HTMLSelectElement>("#theme");
const fontSize = requiredElement<HTMLSelectElement>("#font-size");
const params = new URLSearchParams(location.search);
select.value = params.get("mode") ?? "exploration";
theme.value = params.get("theme") ?? "light";
fontSize.value = params.get("font") ?? "14";
document.documentElement.dataset.preview = params.has("preview") ? "true" : "false";
function show() {
  document.documentElement.dataset.theme = theme.value;
  document.documentElement.style.setProperty("--codex-chat-font-size", `${fontSize.value}px`);
  const english = document.documentElement.lang === "en";
  const native = select.value === "native";
  requiredElement<HTMLElement>("#native-goal").hidden = !native;
  const vm = native
    ? nativeFixture(english)
    : select.value === "current"
      ? currentTaskFixture(english)
      : select.value.startsWith("glass")
        ? glassFixture(english, Number(select.value.split("-")[1] ?? 34))
        : taskFixture(select.value, english);
  const location = macosGoalRowV1Locator.locate(document);
  if (native && !location.target)
    throw new Error(`Native fixture anchor: ${location.rejectionReason}`);
  const result = controller.ensureMounted(vm, preference, {
    displayTarget:
      native && location.target ? { kind: "native", ...location.target } : { kind: "fallback" },
  });
  requiredElement("#result").textContent = JSON.stringify(
    {
      action: result.action,
      displayMode: result.displayMode,
      reason: result.reason,
      savedPlacement: preference.placement,
    },
    null,
    2,
  );
}
select.addEventListener("change", () => {
  controller.unmount();
  show();
});
requiredElement("#locale").addEventListener("click", () => {
  document.documentElement.lang = document.documentElement.lang === "en" ? "zh-CN" : "en";
  show();
});
requiredElement("#remount").addEventListener("click", () => {
  controller.unmount();
  show();
});
show();
theme.addEventListener("change", show);
fontSize.addEventListener("change", show);
requiredElement<HTMLInputElement>("#background").addEventListener("change", (event) => {
  document.documentElement.dataset.background = (event.target as HTMLInputElement).checked
    ? "true"
    : "false";
});
requiredElement<HTMLInputElement>("#refraction").addEventListener("change", (event) => {
  const host = document.querySelector<HTMLElement>("codex-goal-progress");
  if ((event.target as HTMLInputElement).checked) host?.style.removeProperty("--gp-handle-filter");
  else host?.style.setProperty("--gp-handle-filter", "none");
});
