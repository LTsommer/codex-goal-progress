import { GoalProgressViewModelSchema } from "../packages/contracts/src/index.js";

export function taskFixture(mode: string, english: boolean) {
  const completed = mode === "completed";
  const checklist = mode === "checklist" || completed;
  const objective = english ? "Investigate slow page loading" : "排查页面加载缓慢的原因";
  return GoalProgressViewModelSchema.parse({
    schemaVersion: 2,
    contractId: "gp_task_demo",
    sessionId: "demo-thread",
    revision: 1,
    scopeRevision: 1,
    trackingPhase: mode === "completed" ? "completed" : mode === "paused" ? "paused" : "active",
    objective,
    task: {
      objective,
      currentStep: english ? "Compare requests and cache behavior" : "对比请求耗时与缓存行为",
      findings: [
        english ? "Delay occurs on the first visit" : "延迟发生在首次访问",
        english ? "Static assets load normally" : "静态资源加载正常",
      ],
      openQuestions: [
        english ? "Is the delay in the API or database?" : "耗时来自接口处理还是数据库查询？",
      ],
    },
    overallProgressBps: checklist ? (completed ? 10000 : 5000) : null,
    overallPercent: checklist ? (completed ? 100 : 50) : null,
    finalVerificationPending: false,
    objectives: checklist
      ? [
          {
            id: "C1",
            title: english ? "Locate the bottleneck" : "定位性能瓶颈",
            currentItemTitle: english ? "Verify query timings" : "核实查询耗时",
            status: completed ? "completed" : "active",
            progressBps: completed ? 10000 : 5000,
            progressPercent: completed ? 100 : 50,
            completionVerification: completed ? "verified" : null,
          },
        ]
      : [],
    optionalObjectives: [],
    maxVisibleObjectives: 3,
  });
}

export function nativeFixture(english: boolean) {
  const { task: _task, ...view } = taskFixture("checklist", english);
  return GoalProgressViewModelSchema.parse({
    ...view,
    contractId: "gp_native_demo",
    token: { used: 12480, budget: 50000, label: "Goal tokens" },
  });
}
