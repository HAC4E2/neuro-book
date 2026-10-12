import {NbdevError} from "./errors.js";

/**
 * Work 与 Task 的编号格式，必须与 `scripts/ci/agent-governance-contract.ts` 的治理检查一致；
 * 根脚本测试 `scripts/ci/dev-panel-records.test.ts` 按行为比对两边。
 * Task 序号 01–99 写两位，100 起写三位且不带前导零（t050 与 t50 不能成为同一序号的两个身份）。
 */
export const WORK_ID_PATTERN = /^w(?!00000)[0-9]{5}-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const TASK_ID_PATTERN = /^t(?:(?!00)[0-9]{2}|[1-9][0-9]{2})-[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const MAX_WORK_NUMBER = 99_999;
export const MAX_TASK_NUMBER = 999;

export type ParsedId = {id: string; number: number; slug: string};

export function parseWorkId(id: string): ParsedId | null {
    if (!WORK_ID_PATTERN.test(id)) return null;
    return {id, number: Number(id.slice(1, 6)), slug: id.slice(7)};
}

export function parseTaskId(id: string): ParsedId | null {
    if (!TASK_ID_PATTERN.test(id)) return null;
    const separator = id.indexOf("-");
    return {id, number: Number(id.slice(1, separator)), slug: id.slice(separator + 1)};
}

/** `w00023` 这样的编号标签，用于提交消息与引用。 */
export function workNumberLabel(number: number): string {
    if (!Number.isInteger(number) || number < 1 || number > MAX_WORK_NUMBER) {
        throw new NbdevError("number_exhausted", `Work 序号超出范围：${number}`, {details: {number}});
    }
    return `w${String(number).padStart(5, "0")}`;
}

/** `t07`、`t100` 这样的编号标签。 */
export function taskNumberLabel(number: number): string {
    if (!Number.isInteger(number) || number < 1 || number > MAX_TASK_NUMBER) {
        throw new NbdevError("number_exhausted", `Task 序号超出范围：${number}`, {details: {number}});
    }
    return `t${String(number).padStart(2, "0")}`;
}

export function assertSlug(slug: string): void {
    if (!SLUG_PATTERN.test(slug)) {
        throw new NbdevError("invalid_slug", `名称必须是 kebab-case（小写字母、数字与连字符）：${slug}`, {details: {slug}});
    }
}

export function formatWorkId(number: number, slug: string): string {
    assertSlug(slug);
    return `${workNumberLabel(number)}-${slug}`;
}

export function formatTaskId(number: number, slug: string): string {
    assertSlug(slug);
    return `${taskNumberLabel(number)}-${slug}`;
}

/** 接受完整 id 或只有编号的 `w00022`，返回编号；都不是时返回 null。 */
export function workRefNumber(ref: string): number | null {
    const parsed = parseWorkId(ref);
    if (parsed) return parsed.number;
    if (/^w(?!00000)[0-9]{5}$/u.test(ref)) return Number(ref.slice(1));
    return null;
}

/** 接受完整 id 或只有编号的 `t06`、`t100`，返回编号；都不是时返回 null。 */
export function taskRefNumber(ref: string): number | null {
    const parsed = parseTaskId(ref);
    if (parsed) return parsed.number;
    if (/^t(?:(?!00)[0-9]{2}|[1-9][0-9]{2})$/u.test(ref)) return Number(ref.slice(1));
    return null;
}
