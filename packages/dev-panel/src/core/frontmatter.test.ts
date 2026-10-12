import {describe, expect, test} from "bun:test";
import {firstParagraph, parseFrontmatter, readSection, readTitle, setFrontmatterFields} from "./frontmatter.js";

const TASK = "---\nschema: nbook.task/v2\ntaskId: t01-a  # 注释\nstatus: planned\n---\n\n# 标题\n\n## 目标与范围\n\n做事。\n";

describe("frontmatter", () => {
    test("解析字段与正文", () => {
        const parsed = parseFrontmatter(TASK);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.data).toEqual({schema: "nbook.task/v2", taskId: "t01-a", status: "planned"});
        expect(readTitle(parsed.body)).toBe("标题");
        expect(parseFrontmatter("# 没有 frontmatter").ok).toBe(false);
        expect(parseFrontmatter("---\n- a\n---\n").ok).toBe(false);
    });

    test("按行改写：替换已有字段、追加缺少的字段，其余原样保留", () => {
        const rewritten = setFrontmatterFields(TASK, {status: "done", updated: "2026-10-12"});
        expect(rewritten).toBe("---\nschema: nbook.task/v2\ntaskId: t01-a  # 注释\nstatus: done\nupdated: 2026-10-12\n---\n\n# 标题\n\n## 目标与范围\n\n做事。\n");
    });

    test("保留 CRLF 换行", () => {
        const crlf = TASK.replaceAll("\n", "\r\n");
        const rewritten = setFrontmatterFields(crlf, {status: "active"});
        expect(rewritten).toBe(crlf.replace("status: planned", "status: active"));
    });

    test("节与第一段", () => {
        const body = "# Work\n\n第一段，\n续行。\n\n## 目标\n\n目标正文。\n\n- 一条\n\n## 其它\n\n别的。\n";
        expect(readSection(body, "目标")).toBe("目标正文。\n\n- 一条");
        expect(readSection(body, "不存在")).toBeNull();
        expect(firstParagraph(body)).toBe("第一段， 续行。");
        expect(firstParagraph("# 只有标题\n")).toBeNull();
    });
});
