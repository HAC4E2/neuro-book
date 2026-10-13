/**
 * 两版文本的行级差异（最长公共子序列）：编辑页遇到 `hash_mismatch` 时，用打开时的原文与现在的文本算出“别人改了什么”。
 * 编辑的文件最多几千行；超过 `MAX_CELLS` 时不逐行比，整段标成删除加新增，避免在浏览器里算平方级的大表。
 */
export type DiffLine = {kind: "same" | "add" | "del"; text: string};

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
    const left = before.split("\n");
    const right = after.split("\n");
    if (left.length * right.length > MAX_CELLS) {
        return [...left.map((text) => ({kind: "del" as const, text})), ...right.map((text) => ({kind: "add" as const, text}))];
    }
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i -= 1) {
        for (let j = right.length - 1; j >= 0; j -= 1) {
            table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
    }
    const lines: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length && j < right.length) {
        if (left[i] === right[j]) {
            lines.push({kind: "same", text: left[i]!});
            i += 1;
            j += 1;
        } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
            lines.push({kind: "del", text: left[i]!});
            i += 1;
        } else {
            lines.push({kind: "add", text: right[j]!});
            j += 1;
        }
    }
    while (i < left.length) lines.push({kind: "del", text: left[i++]!});
    while (j < right.length) lines.push({kind: "add", text: right[j++]!});
    return lines;
}

/** 写成统一差异的样子（`+`、`-`、空格开头），给 `DiffView` 显示；相同的行只留改动前后各 3 行。 */
export function diffText(lines: readonly DiffLine[], context = 3): string {
    const keep = lines.map(() => false);
    lines.forEach((line, index) => {
        if (line.kind === "same") return;
        for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k += 1) keep[k] = true;
    });
    const out: string[] = [];
    let skipped = false;
    lines.forEach((line, index) => {
        if (!keep[index]) {
            if (!skipped) out.push("@@");
            skipped = true;
            return;
        }
        skipped = false;
        out.push(`${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`);
    });
    return out.join("\n");
}
