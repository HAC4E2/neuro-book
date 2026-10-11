/**
 * 书架的显示规则（docs/specs/workbench/bookshelf.md）：字数与时间的写法、作品的色档、排序、继续写作选哪一部、最近写到、合计。
 * 纯函数，组件与测试共用。
 */

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../shared/shelf";
import type {ShelfItem, ShelfLastEdit} from "../shared/shelf";

export type ShelfSort = "recent" | "title" | "words";

/**
 * 作品色板（布面：群青、松绿、朱红、橘、紫、青、芥黄、石墨）。新建对话框的色板就是这八色，作者没指定颜色时也按 id 从
 * 这八色里取一色，所以“自动”与色板是同一套颜色。八色与封面上的浅色字的对比度都不低于 3:1（封面书名是大字），所以封面
 * 上的字总用浅色；不随主题变化，像真书的封面。
 */
export const BOOK_PALETTE: readonly string[] = ["#2f63a8", "#2e7d55", "#b8423a", "#c8692a", "#7351a8", "#1d8a8c", "#b08328", "#4a4f57"];

const TEXT = {
    words: {"zh-CN": "{count} 字", "en-US": "{count} words"},
    wordsTenThousand: {"zh-CN": "{count} 万字", "en-US": "{count}k words"},
    files: {"zh-CN": "{count} 篇", "en-US": "{count} files"},
    books: {"zh-CN": "{count} 部作品", "en-US": "{count} books"},
    today: {"zh-CN": "今天 {count} 字", "en-US": "{count} today"},
    todayAt: {"zh-CN": "今天 {time}", "en-US": "Today {time}"},
    yesterdayAt: {"zh-CN": "昨天 {time}", "en-US": "Yesterday {time}"},
} satisfies Record<string, LocalizedText>;

function grouped(count: number, locale: DisplayLocale): string {
    return new Intl.NumberFormat(locale).format(count);
}

/** 字数：中文一万以上写“万字”，英文一千以上写“k”，都留一位小数并去掉 `.0`。 */
export function formatWords(count: number, locale: DisplayLocale): string {
    const unit = locale === "zh-CN" ? 10_000 : 1_000;
    if (count < unit) return localize(formatText(TEXT.words, {count: grouped(count, locale)}), locale);
    const scaled = (Math.round((count / unit) * 10) / 10).toString();
    return localize(formatText(TEXT.wordsTenThousand, {count: scaled}), locale);
}

export function formatFiles(count: number, locale: DisplayLocale): string {
    return localize(formatText(TEXT.files, {count: grouped(count, locale)}), locale);
}

export function formatBooks(count: number, locale: DisplayLocale): string {
    return localize(formatText(TEXT.books, {count: grouped(count, locale)}), locale);
}

/** 今天净增的字数；减少时带负号（U+2212），不显示为 0。 */
export function formatToday(count: number, locale: DisplayLocale): string {
    return localize(formatText(TEXT.today, {count: formatSigned(count, locale)}), locale);
}

/** 带符号的整数：负数用 U+2212。 */
export function formatSigned(count: number, locale: DisplayLocale): string {
    return count < 0 ? `−${grouped(-count, locale)}` : grouped(count, locale);
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 某个时刻相对 `now` 的写法：今天、昨天带时分，今年只写月日，更早带年份。按浏览器的本地时区。 */
export function formatWhen(at: string, now: string, locale: DisplayLocale): string {
    const date = new Date(at);
    const today = new Date(now);
    const time = new Intl.DateTimeFormat(locale, {hour: "2-digit", minute: "2-digit", hour12: false}).format(date);
    if (sameDay(date, today)) return localize(formatText(TEXT.todayAt, {time}), locale);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (sameDay(date, yesterday)) return localize(formatText(TEXT.yesterdayAt, {time}), locale);
    const options: Intl.DateTimeFormatOptions = date.getFullYear() === today.getFullYear()
        ? {month: "long", day: "numeric"}
        : {year: "numeric", month: "long", day: "numeric"};
    return new Intl.DateTimeFormat(locale, options).format(date);
}

/** 没有指定颜色的作品按 id 在色板里取一色的序号：同一部作品在任何窗口、任何时候都是同一色。 */
export function bookPaletteIndex(id: string): number {
    let hash = 0;
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash % BOOK_PALETTE.length;
}

/** 作者没指定颜色时这部作品用的颜色（色板里的一色），给封面、色板的“自动”与目录选择器的作品色块用。 */
export function autoBookColor(id: string): string {
    return BOOK_PALETTE[bookPaletteIndex(id)] as string;
}

/** 封面底色：作者给的颜色，没有时用自动色。经样式变量 `--book-bg` 交给封面。 */
export function bookColorStyle(item: {readonly id: string; readonly color: string | null}): Record<string, string> {
    return {"--book-bg": item.color ?? autoBookColor(item.id)};
}

/** 作者给的颜色够亮时文字用深色；色板八色都够深，自动色的字总是浅色。 */
export function lightColor(color: string | null): boolean {
    if (color === null) return false;
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
    if (match === null) return false;
    const [r, g, b] = match.slice(1).map((part) => {
        const channel = Number.parseInt(part, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}

function lastAt(item: ShelfItem): number {
    return item.stats.last === null ? Number.NEGATIVE_INFINITY : Date.parse(item.stats.last.at);
}

/** 排序。比较相等时按显示名，再按 id，结果稳定。 */
export function sortShelf(items: ReadonlyArray<ShelfItem>, sort: ShelfSort, locale: DisplayLocale): ShelfItem[] {
    const collator = new Intl.Collator(locale, {numeric: true, sensitivity: "base"});
    const byName = (a: ShelfItem, b: ShelfItem): number => collator.compare(projectDisplayName(a), projectDisplayName(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const primary: Record<ShelfSort, (a: ShelfItem, b: ShelfItem) => number> = {
        recent: (a, b) => lastAt(b) - lastAt(a),
        title: () => 0,
        words: (a, b) => b.stats.words - a.stats.words,
    };
    return [...items].sort((a, b) => primary[sort](a, b) || byName(a, b));
}

/** 继续写作的那一部：最近编辑时间最晚的；都没有编辑记录时为 null。 */
export function continueTarget(items: ReadonlyArray<ShelfItem>): ShelfItem | null {
    let best: ShelfItem | null = null;
    for (const item of items) {
        if (item.stats.last !== null && (best === null || lastAt(item) > lastAt(best))) best = item;
    }
    return best;
}

export interface RecentPiece {
    readonly item: ShelfItem;
    readonly last: ShelfLastEdit;
}

/** 最近写到的片段：各作品最近编辑的那个文件，按时间从近到远取前 `limit` 条。 */
export function recentPieces(items: ReadonlyArray<ShelfItem>, limit = 3): RecentPiece[] {
    return items
        .flatMap((item) => (item.stats.last === null ? [] : [{item, last: item.stats.last}]))
        .sort((a, b) => Date.parse(b.last.at) - Date.parse(a.last.at))
        .slice(0, limit);
}

export interface ShelfTotals {
    readonly words: number;
    readonly files: number;
    readonly books: number;
    /** 今天净增的合计；没有一部作品给出今天的数字时为 null。 */
    readonly today: number | null;
}

/** 案头的合计：字数与篇数把有统计的作品加起来，今天只加有今天数字的。 */
export function shelfTotals(items: ReadonlyArray<ShelfItem>): ShelfTotals {
    let today: number | null = null;
    let words = 0;
    let files = 0;
    for (const item of items) {
        words += item.stats.words;
        files += item.stats.files;
        if (item.stats.today !== null) today = (today ?? 0) + item.stats.today;
    }
    return {words, files, books: items.length, today};
}
