import {daysSince} from "./format.js";
import type {OverviewWork} from "./types.js";

/**
 * 左栏的描述表与 Work 树的取舍（t15 阶段 2b）。左栏的条目从这里来，路由仍在 `router.ts` 里显式声明；
 * 零件 `PanelNav` 按它画，桌面左栏与手机抽屉共用。本文件不用 DOM 类型（L1 测试在 Node 类型下导入它）。
 */

/** 条目右边的计数从宿主给的哪一项来。 */
export type NavCount = "inbox" | "sessions" | "runs";
export type NavEntry = {
    key: string;
    label: string;
    icon: string;
    href: string;
    /** 高亮的判定：`exact` 只在这一页，`prefix` 在它下面的页也算。 */
    match: "exact" | "prefix";
    count?: NavCount;
    /** 只在主工作区能写时给（新建的入口）。 */
    needsWritable?: boolean;
};
export type NavGroup = {title: string | null; entries: NavEntry[]};

/** 上段固定的条目：首页与新建、资料、现场。Work 树在它们下面，单独滚动。 */
export const NAV_GROUPS: NavGroup[] = [
    {title: null, entries: [
        {key: "home", label: "首页与收件箱", icon: "i-lucide-inbox", href: "/", match: "exact", count: "inbox"},
        {key: "new", label: "新建 Work 或 Task", icon: "i-lucide-plus", href: "/new", match: "exact", needsWritable: true},
    ]},
    {title: "资料", entries: [
        {key: "artifacts", label: "产物", icon: "i-lucide-files", href: "/artifacts", match: "prefix"},
        {key: "docs", label: "文档", icon: "i-lucide-book-open", href: "/docs", match: "prefix"},
    ]},
    {title: "现场", entries: [
        {key: "sessions", label: "会话", icon: "i-lucide-terminal", href: "/live/sessions", match: "prefix", count: "sessions"},
        {key: "runs", label: "在跑", icon: "i-lucide-activity", href: "/live/runs", match: "prefix", count: "runs"},
        {key: "checkouts", label: "checkout", icon: "i-lucide-git-fork", href: "/live/checkouts", match: "prefix"},
        {key: "github", label: "GitHub", icon: "i-lucide-git-pull-request", href: "/live/github", match: "prefix"},
    ]},
];

export function entryActive(entry: NavEntry, path: string): boolean {
    return entry.match === "exact" ? path === entry.href : path === entry.href || path.startsWith(`${entry.href}/`);
}

/** 30 天内更新过的未标 Work 列在树里；更早的、完成的、搁置的收进“更多”（D4）。 */
export const NAV_RECENT_DAYS = 30;

/** Work 树的取舍（D4）：进行中的都列；未标的只列 30 天内更新过的；其余（完成、搁置、更早的未标、状态写坏的）收进“更多”。 */
export function splitNavWorks(works: readonly OverviewWork[], now: Date = new Date()): {shown: OverviewWork[]; more: OverviewWork[]} {
    const shown: OverviewWork[] = [];
    const more: OverviewWork[] = [];
    for (const work of works) {
        const status = work.status.value;
        const recent = work.updated.value !== null && daysSince(work.updated.value, now) <= NAV_RECENT_DAYS;
        if (status === "active" || (status === null && work.status.origin !== "invalid" && recent)) shown.push(work);
        else more.push(work);
    }
    return {shown, more};
}
