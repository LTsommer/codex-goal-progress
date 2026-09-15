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

// Same data as the approved glass reference, rendered by the real component.
export function glassFixture(english: boolean, progress = 34) {
  const base = taskFixture("checklist", english);
  const title = english ? "Refine the Goal Progress UI" : "完善 Goal Progress 界面";
  const titles = english
    ? ["Base styling", "Theme adaptation", "Visual acceptance"]
    : ["基础样式", "主题适配", "视觉验收"];
  const overall = Math.floor((200 + progress) / 3);
  return GoalProgressViewModelSchema.parse({
    ...base,
    objective: title,
    task: { ...base.task, objective: title },
    overallProgressBps: overall * 100,
    overallPercent: overall,
    objectives: titles.map((name, index) => ({
      id: `C${index + 1}`,
      title: name,
      status: index < 2 || progress === 100 ? "completed" : "active",
      currentItemTitle:
        index === 2
          ? english
            ? "Refine glass depth and readability"
            : "调整玻璃层次与可读性"
          : undefined,
      progressBps: (index < 2 ? 100 : progress) * 100,
      progressPercent: index < 2 ? 100 : progress,
      completionVerification: index < 2 || progress === 100 ? "verified" : null,
    })),
  });
}

export function currentTaskFixture(english: boolean) {
  const base = glassFixture(english);
  const title = english
    ? "Implement clear glass, verify the real component, and update the local plugin"
    : "按用户最终截图实现清透玻璃 UI：清单未完成项及总进度条均带透明胶囊指示块，完成真实组件验收和本机安装";
  const titles = english
    ? [
        "Glass and capsule indicators",
        "Verify themes and interactions",
        "Install and verify locally",
      ]
    : [
        "清透玻璃与双层级胶囊指示块实现",
        "深浅主题与交互通过真实组件验收",
        "本机插件更新并核实运行状态",
      ];
  return GoalProgressViewModelSchema.parse({
    ...base,
    objective: title,
    task: { ...base.task, objective: title },
    overallProgressBps: 5000,
    overallPercent: 50,
    objectives: base.objectives.map((item, index) => ({
      ...item,
      title: titles[index],
      currentItemTitle: undefined,
      status: index === 0 ? "completed" : index === 1 ? "active" : "pending",
      progressBps: index === 0 ? 10000 : 0,
      progressPercent: index === 0 ? 100 : 0,
      completionVerification: index === 0 ? "verified" : null,
    })),
  });
}
