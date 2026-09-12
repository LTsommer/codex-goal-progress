import "../packages/renderer/src/index.js";
import { macosGoalRowV1Locator } from "../packages/codex-adapter/src/anchor-adapter.js";
import { SidecarMountController } from "../packages/codex-adapter/src/sidecar-mount.js";
import { DEFAULT_GOAL_PROGRESS_UI_PREFERENCE } from "../packages/contracts/src/index.js";

import { nativeFixture, taskFixture } from "./task-fixtures.js";

const controller = new SidecarMountController(document, {
  nativeGoalLocator: macosGoalRowV1Locator,
});
function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing demo element: ${selector}`);
  return element;
}
const select = requiredElement<HTMLSelectElement>("#mode");
function show() {
  const english = document.documentElement.lang === "en";
  const native = select.value === "native";
  requiredElement<HTMLElement>("#native-goal").hidden = !native;
  const vm = native ? nativeFixture(english) : taskFixture(select.value, english);
  const location = macosGoalRowV1Locator.locate(document);
  if (native && !location.target)
    throw new Error(`Native fixture anchor: ${location.rejectionReason}`);
  const result = controller.ensureMounted(vm, DEFAULT_GOAL_PROGRESS_UI_PREFERENCE, {
    displayTarget:
      native && location.target ? { kind: "native", ...location.target } : { kind: "fallback" },
  });
  requiredElement("#result").textContent = JSON.stringify(
    {
      action: result.action,
      displayMode: result.displayMode,
      reason: result.reason,
      savedPlacement: DEFAULT_GOAL_PROGRESS_UI_PREFERENCE.placement,
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
