import type {TaskStatus} from "./records.js";

/**
 * 最小 Work README：frontmatter 满足治理检查（schema、workId、issueId），另写 status 与 updated；正文以“目标”一节开头。
 * 不放 Task 表：`task new` 不改 Work README，表会过时；Task 列表以目录与 `nbdev status` 为准。
 */
export function workReadmeTemplate(input: {workId: string; issueId: string | null; title: string; goal: string; date: string}): string {
    return [
        "---",
        "schema: nbook.work/v1",
        `workId: ${input.workId}`,
        `issueId: ${input.issueId ?? "null"}`,
        "status: active",
        `updated: ${input.date}`,
        "---",
        "",
        `# ${input.title}`,
        "",
        "## 目标",
        "",
        input.goal.trim(),
        "",
    ].join("\n");
}

/**
 * 最小 Task README。故意不写“行为合同未变”这几个字：`docs:check` 靠它判断，占位文字会把应有的警告压掉。
 */
export function taskReadmeTemplate(input: {taskId: string; title: string; goal: string | null; status: TaskStatus; date: string}): string {
    return [
        "---",
        "schema: nbook.task/v2",
        `taskId: ${input.taskId}`,
        `status: ${input.status}`,
        `updated: ${input.date}`,
        "---",
        "",
        `# ${input.title}`,
        "",
        "## 目标与范围",
        "",
        input.goal?.trim() || "待补充。",
        "",
        "合同：待补充（链接具体 Spec，或说明行为合同是否改变）。",
        "",
        "## 当前状态",
        "",
        `${input.date} 经 nbdev 新建，尚未开工。`,
        "",
        "## 下一步",
        "",
        "待补充。",
        "",
    ].join("\n");
}
