import { html } from "lit";
import type {
  GoalProgressPlacement,
  GoalProgressUpdateState,
  GoalProgressViewModel,
} from "../../../contracts/src/index.js";
import { renderCompletionFooter } from "./completion-footer.js";
import { renderCurrentSummary } from "./current-summary.js";
import { renderNotices } from "./notices.js";
import { type ObjectiveListRenderOptions, renderObjectiveLists } from "./objective-list.js";
import { renderOverallProgress } from "./overall-progress.js";
import { renderTaskDetails, taskLabels } from "./task.js";

export interface TrackingRenderOptions extends ObjectiveListRenderOptions {
  readonly collapsed: boolean;
  readonly locale: string;
  readonly motionPaused: boolean;
  readonly placement: GoalProgressPlacement;
  readonly requestedPlacement: GoalProgressPlacement;
  readonly spaceConstrained: boolean;
  readonly floatingPanelConstrained: boolean;
  readonly settingsOpen: boolean;
  readonly onFloatingKeyDown: (event: KeyboardEvent) => void;
  readonly onFloatingPointerCancel: (event: PointerEvent) => void;
  readonly onFloatingPointerDown: (event: PointerEvent) => void;
  readonly onFloatingPointerMove: (event: PointerEvent) => void;
  readonly onFloatingPointerUp: (event: PointerEvent) => void;
  readonly onSelectPlacement: (placement: GoalProgressPlacement) => void;
  readonly onCheckUpdate: () => void;
  readonly onOpenCurrentRelease: () => void;
  readonly onOpenLatestRelease: () => void;
  readonly onRestartLater: () => void;
  readonly onRestartNow: () => void;
  readonly onRetryUpdate: () => void;
  readonly onStartUpdate: () => void;
  readonly onToggleMotionPaused: () => void;
  readonly onTogglePlacementSettings: (event: MouseEvent) => void;
  readonly onToggleCollapsed: () => void;
  readonly updatePromptDismissed: boolean;
  readonly updateState: GoalProgressUpdateState | null;
  readonly updateUnread: boolean;
}

function renderDetails(viewModel: GoalProgressViewModel, options: TrackingRenderOptions) {
  const externalUpdatePhase =
    options.updateState &&
    [
      "available",
      "preparing",
      "downloading",
      "verifying",
      "download-failed",
      "update-failed",
      "restart-required",
    ].includes(options.updateState.phase) &&
    !options.updatePromptDismissed;
  return html`
    <div class="content ${externalUpdatePhase ? "has-update-prompt" : ""}">
      ${viewModel.task ? renderTaskDetails(viewModel, options.locale) : null}
      ${!viewModel.task || viewModel.overallPercent !== null ? renderCurrentSummary(viewModel, options.messages) : null}
      ${viewModel.task && viewModel.overallPercent === null ? null : renderObjectiveLists(viewModel, options)}
      ${renderNotices(viewModel, options.messages)}
      ${renderCompletionFooter(viewModel, options)}
    </div>
  `;
}

export function renderTrackingView(
  viewModel: GoalProgressViewModel,
  options: TrackingRenderOptions,
) {
  if (viewModel.task) {
    const labels = taskLabels(options.locale);
    options = {
      ...options,
      messages: {
        ...options.messages,
        overallLabel: labels.title,
        expandProgress: labels.expand,
        collapseProgress: labels.collapse,
        overallProgress: labels.title,
        floatingProgress: labels.title,
        goalCompleted: labels.completed,
      },
    };
  }
  if (options.placement === "floating") {
    return html`
      <div
        class="floating-shell ${viewModel.task ? "task-shell" : ""}"
        @pointerdown=${options.onFloatingPointerDown}
        @pointermove=${options.onFloatingPointerMove}
        @pointerup=${options.onFloatingPointerUp}
        @pointercancel=${options.onFloatingPointerCancel}
      >
        ${
          options.collapsed || options.floatingPanelConstrained
            ? null
            : html`<div class="floating-panel">${renderDetails(viewModel, options)}</div>`
        }
        <div
          class="floating-chip ${viewModel.task ? "task-chip" : ""}"
          role="group"
          aria-label=${options.messages.floatingProgress}
          tabindex="0"
          @keydown=${options.onFloatingKeyDown}
        >
          ${renderOverallProgress(viewModel, {
            compact: true,
            collapsed: options.collapsed,
            toggleDisabled: options.floatingPanelConstrained && !options.collapsed,
            toggleDisabledLabel: options.messages.spaceRestoredAutoExpand,
            onToggleCollapsed: options.onToggleCollapsed,
            showUpdateUnread:
              options.updateUnread && (options.collapsed || options.floatingPanelConstrained),
            messages: options.messages,
            locale: options.locale,
          })}
        </div>
      </div>
    `;
  }
  const compact = options.collapsed;
  return html`
    ${
      compact
        ? renderOverallProgress(viewModel, {
            compact: true,
            collapsed: options.collapsed,
            onToggleCollapsed: options.onToggleCollapsed,
            showUpdateUnread: options.updateUnread,
            messages: options.messages,
            locale: options.locale,
          })
        : html`
          ${renderDetails(viewModel, options)}
          ${renderOverallProgress(viewModel, {
            compact: false,
            collapsed: false,
            onToggleCollapsed: options.onToggleCollapsed,
            messages: options.messages,
            locale: options.locale,
          })}
        `
    }
  `;
}
