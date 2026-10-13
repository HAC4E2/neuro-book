import type {RecordedValue} from "./types.js";

/** 记录字段的显示：状态的中文名与色调；没有字段的显示“未标”，不合规的显示“不合规”（不推断）。 */

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

const STATUS: Record<string, {label: string; tone: Tone}> = {
    planned: {label: "计划中", tone: "neutral"},
    active: {label: "进行中", tone: "accent"},
    done: {label: "完成", tone: "success"},
    shelved: {label: "搁置", tone: "warning"},
};

export function statusDisplay(status: RecordedValue): {label: string; tone: Tone; marked: boolean} {
    if (status.origin === "invalid") return {label: "不合规", tone: "danger", marked: true};
    if (status.value === null) return {label: "未标", tone: "neutral", marked: false};
    return {...(STATUS[status.value] ?? {label: status.value, tone: "neutral"}), marked: true};
}

/** `YYYY-MM-DD` 或 ISO 时刻到现在的天数（按本地日期算）。 */
export function daysSince(value: string, now: Date = new Date()): number {
    const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((today.getTime() - day.getTime()) / 86_400_000);
}

export function relativeTime(iso: string, now: Date = new Date()): string {
    const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes} 分钟前`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} 小时前`;
    return `${Math.round(hours / 24)} 天前`;
}

export function relativeDay(value: string, now: Date = new Date()): string {
    const days = daysSince(value, now);
    if (days <= 0) return "今天";
    if (days === 1) return "昨天";
    return days < 60 ? `${days} 天前` : value.slice(0, 10);
}

/** 会话键的短写：`claude:<uuid>` 取前 8 位；omp 的会话文件路径只留文件名。 */
export function shortSession(key: string, label: string | null = null): string {
    if (label) return label;
    const [agent, ...rest] = key.split(":");
    const id = rest.join(":");
    const short = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1).replace(/\.jsonl$/u, "").slice(-12) : id.slice(0, 8);
    return `${agent} ${short}`;
}

export function taskLabel(taskId: string): string {
    return taskId.slice(0, taskId.indexOf("-") > 0 ? taskId.indexOf("-") : undefined);
}

export function workLabel(workId: string): string {
    return workId.slice(0, 6);
}

export const HERDR_STATUS_LABEL: Record<string, string> = {idle: "空闲", working: "工作中", blocked: "受阻", done: "完成一轮", unknown: "未知", unmanaged: "不在 herdr 里"};
