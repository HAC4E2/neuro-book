/**
 * 名字排序（docs/specs/workspace/folder-kinds.md 的“名字排序”）：普通文件夹与内容文件夹的未列入项共用。放在 shared，
 * 让服务端与 Lab 的内存文件适配器用同一个比较。
 */

const collator = new Intl.Collator("zh-CN", {numeric: true, sensitivity: "base"});

const DIGITS: Readonly<Record<string, number>> = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};
const UNITS: Readonly<Record<string, number>> = {十: 10, 百: 100, 千: 1000};
const NUMBERED = /第([零〇一二两三四五六七八九十百千万]+)(?=[卷章回节部集篇幕话])/gu;

/**
 * 中文数字转成数值：有十、百、千、万时按位权（“十二”“一百零五”“两万三千”），没有时逐位拼（“一〇二”是 102）。
 */
export function chineseNumber(text: string): number {
    if (!/[十百千万]/u.test(text)) return Number([...text].map((char) => DIGITS[char] ?? 0).join(""));
    let total = 0;
    let section = 0;
    let digit = 0;
    for (const char of text) {
        if (char in DIGITS) {
            digit = DIGITS[char] as number;
        } else if (char === "万") {
            total += (section + digit) * 10000;
            section = 0;
            digit = 0;
        } else {
            // “十二”开头的十没有前置数字，按一十算。
            section += (digit === 0 ? 1 : digit) * (UNITS[char] as number);
            digit = 0;
        }
    }
    return total + section + digit;
}

/** 比较键：“第 + 中文数字 + 卷 / 章 …”里的中文数字换成阿拉伯数字，交给按数值比的 collator。 */
function sortKey(name: string): string {
    return name.replace(NUMBERED, (_, numeral: string) => `第${String(chineseNumber(numeral))}`);
}

/** 名字排序：中文自然排序（含“第 N 章”里的中文数字），比较键相等时按原名的 UTF-16 码元次序，结果是全序。 */
export function compareNames(left: string, right: string): number {
    return collator.compare(sortKey(left), sortKey(right)) || (left < right ? -1 : left > right ? 1 : 0);
}

/** 目录在前，再按名字排序（普通文件夹与内容文件夹的未列入项）。 */
export function compareEntries(left: {readonly name: string; readonly kind: string}, right: {readonly name: string; readonly kind: string}): number {
    const directory = Number(right.kind === "directory") - Number(left.kind === "directory");
    return directory || compareNames(left.name, right.name);
}
