/**
 * Markdown 正文按二级标题取节。单独一个没有依赖的模块：面板前端（Work 页展开 Task 时取“当前状态”“下一步”）直接导入，
 * 不经过带 yaml 依赖的 frontmatter.ts。
 */

/** `## <heading>` 一节的正文（到下一个一级或二级标题为止），去掉首尾空白；没有这一节或为空时返回 null。 */
export function readSection(body: string, heading: string): string | null {
    const lines = body.split(/\r?\n/u);
    const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
    if (start < 0) return null;
    const collected: string[] = [];
    for (const line of lines.slice(start + 1)) {
        if (/^#{1,2} /u.test(line)) break;
        collected.push(line);
    }
    const text = collected.join("\n").trim();
    return text === "" ? null : text;
}
