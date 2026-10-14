/**
 * 新建 Work 与 Task 的表单各有哪些字段（t15 阶段 3c）。表单零件按它吸收预览与提交时的字段问题；新建页按它判断提交失败里
 * 哪些问题能锚到字段（只在字段旁边报一次），哪些要写进结果。字段名与服务端的 `details.field`、`problems[].field` 一致。
 */
export const WORK_FORM_FIELDS: ReadonlySet<string> = new Set(["slug", "title", "goal", "issue", "taskSlug", "taskTitle", "taskStatus"]);
export const TASK_FORM_FIELDS: ReadonlySet<string> = new Set(["workId", "slug", "title", "goal", "status"]);
