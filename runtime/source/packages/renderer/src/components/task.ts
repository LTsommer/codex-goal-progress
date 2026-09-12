import { html } from "lit";
import type { GoalProgressViewModel } from "../../../contracts/src/index.js";

export function taskLabels(locale: string) {
  return locale.toLowerCase().startsWith("zh")
    ? {
        title: "任务进度",
        expand: "展开任务进度",
        collapse: "收起任务进度",
        scope: "范围待明确",
        current: "当前调查",
        findings: "已确认",
        questions: "待明确",
        empty: "暂无记录",
        completed: "任务已完成",
        paused: "任务已暂停",
        blocked: "任务受阻",
      }
    : {
        title: "Task progress",
        expand: "Expand task progress",
        collapse: "Collapse task progress",
        scope: "Scope to be clarified",
        current: "Current investigation",
        findings: "Confirmed",
        questions: "Open questions",
        empty: "No entries yet",
        completed: "Task completed",
        paused: "Task paused",
        blocked: "Task blocked",
      };
}

export function renderTaskDetails(viewModel: GoalProgressViewModel, locale: string) {
  const task = viewModel.task;
  if (!task) return null;
  const labels = taskLabels(locale);
  const list = (title: string, items: string[]) =>
    html`<section class="task-section"><strong>${title}</strong>${items.length ? html`<ul>${items.map((item) => html`<li>${item}</li>`)}</ul>` : html`<p>${labels.empty}</p>`}</section>`;
  return html`<div class="task-details">
    <strong class="task-title">${task.objective}</strong>
    ${viewModel.trackingPhase === "paused" ? html`<p>${labels.paused}</p>` : viewModel.trackingPhase === "completed" ? html`<p>${labels.completed}</p>` : viewModel.trackingPhase === "blocked" ? html`<p>${labels.blocked}</p>` : null}
    ${task.completionEvidence ? html`<p>${task.completionEvidence.summary}</p>` : null}
    ${viewModel.overallPercent === null ? html`<p class="current-summary"><strong>${labels.current}</strong><span class="current-summary-text">${task.currentStep || labels.empty}</span></p>` : null}
    ${viewModel.overallPercent === null ? html`${list(labels.findings, task.findings)}${list(labels.questions, task.openQuestions)}` : null}
  </div>`;
}
