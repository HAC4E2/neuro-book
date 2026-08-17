import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {checkDocumentation} from "nbook/scripts/ci/check-documentation";
import {createTestTmpRoot} from "nbook/server/workspace-files/test-tmp-sweep";

const fixtureRoots: string[] = [];
const REQUIRED_INDEXES = [
    "docs/README.md",
    "docs/AGENTS.md",
    "docs/specs/README.md",
    "docs/specs/AGENTS.md",
    "docs/specs/TEMPLATE.md",
    "docs/standards/README.md",
    "docs/proposals/README.md",
    "docs/adr/README.md",
    "docs/testing/README.md",
    "docs/testing/manual-eval/README.md",
    "docs/migrations/README.md",
    "docs/runbooks/README.md",
    "docs/research/README.md",
    "docs/archived/README.md",
] as const;

const SPEC_REGISTRY = `# NeuroBook 规范编程

## 已实现规范

| 功能域 | 当前规范 | 说明 |
|---|---|---|

## 待实现规范

| 功能域 | 目标规范 | 说明 |
|---|---|---|

## 冻结过渡规范

| 功能域 | 当前规范 | 固定目标 |
|---|---|---|
`;

function specDocument(options: {capability: string; status?: "planned" | "implemented"; body?: string; owners?: readonly string[]}): string {
    const status = options.status ?? "planned";
    const requiredBody = [
        ...[
            "目标与非目标",
            "术语与参与者",
            "输入与前置条件",
            "输出与可观察行为",
            "状态与转换",
            "副作用与数据",
            "失败与恢复",
            "边界与兼容",
            "验收与 Smoke",
        ].map((heading) => `## ${heading}\n\n有效说明。`),
        ...(status === "implemented" ? ["## 实现合同\n\n有效实现合同。"] : []),
        "## 证据\n\n[Registry](../README.md)",
    ].join("\n\n");
    return `---
schema: nbook.spec/v1
kind: behavior
status: ${status}
capability: ${options.capability}
owners:
${(options.owners ?? ["test-module"]).map((owner) => `  - ${owner}`).join("\n")}
---

# Test Spec

${options.body ?? requiredBody}
`;
}

afterEach(async () => {
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("documentation governance gate", () => {
    it("合法目录、ADR 和相对链接通过", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Architecture](../specs/architecture.md)\n",
            "docs/specs/architecture.md": specDocument({capability: "test.architecture"}),
            "docs/adr/0001-first-decision.md": "# ADR 0001：First decision\n",
        }, {
            planned: ["docs/specs/architecture.md"],
        });

        expect(checkDocumentation(fixture.root, fixture.paths)).toEqual({
            failures: [],
            checkedFiles: fixture.paths.length,
        });
    });

    it("坏相对链接报告来源和解析目标", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/rules.md": "# Rules\n\n[Missing](missing.md)\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/rules.md -> missing.md（docs/standards/missing.md）");
    });

    it("重复 ADR 编号同时报告两个文件", async () => {
        const fixture = await createDocumentationFixture({
            "docs/adr/0001-first-decision.md": "# ADR 0001：First decision\n",
            "docs/adr/0001-second-decision.md": "# ADR 0001：Second decision\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("ADR 编号重复 0001：docs/adr/0001-first-decision.md, docs/adr/0001-second-decision.md");
    });

    it("拒绝 docs 根层正文和已迁移 Workspace Reference", async () => {
        const fixture = await createDocumentationFixture({
            "docs/stray.md": "# Stray\n",
            "reference/workspace/TERMS.md": "# Workspace Terms\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("docs 根层只允许 README.md 和 AGENTS.md：docs/stray.md");
        expect(report.failures).toContain("已迁移的 reference/workspace 不得重新出现：reference/workspace/TERMS.md");
    });

    it("拒绝重新创建旧人工评测顶层目录", async () => {
        const fixture = await createDocumentationFixture({
            "docs/manual-eval/README.md": "# Retired manual eval location\n",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("人工评测已迁入 docs/testing/manual-eval：docs/manual-eval/README.md");
    });


    it("拒绝缺少 frontmatter 或行为章节的 Spec", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/missing-frontmatter.md": "# Missing metadata\n",
            "docs/specs/incomplete.md": specDocument({capability: "test.incomplete", body: "## 目标与非目标\n"}),
        }, {
            planned: ["docs/specs/missing-frontmatter.md", "docs/specs/incomplete.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("Spec 缺少 YAML frontmatter：docs/specs/missing-frontmatter.md");
        expect(report.failures).toContain("Behavior Spec 缺少“输入与前置条件”章节：docs/specs/incomplete.md");
    });

    it("拒绝成熟度登记错位和重复 capability", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/first.md": specDocument({capability: "test.duplicate", status: "implemented", body: [
                "## 目标与非目标",
                "## 术语与参与者",
                "## 输入与前置条件",
                "## 输出与可观察行为",
                "## 状态与转换",
                "## 副作用与数据",
                "## 失败与恢复",
                "## 边界与兼容",
                "## 验收与 Smoke",
                "## 实现合同",
                "## 证据",
            ].join("\n\n")}),
            "docs/specs/second.md": specDocument({capability: "test.duplicate"}),
        }, {
            planned: ["docs/specs/first.md", "docs/specs/second.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("Spec 未登记在“已实现规范”：docs/specs/first.md");
        expect(report.failures).toContain("Spec 登记的成熟度与 frontmatter 不一致：docs/specs/first.md（implemented）");
        expect(report.failures).toContain("Spec capability 重复 test.duplicate：docs/specs/first.md, docs/specs/second.md");
    });

    it("允许模块 README、AGENTS 和省略 md 的具体 Spec 登记", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/README.md": "# Editor Specs\n",
            "docs/specs/editor/AGENTS.md": "# Editor Spec Agent\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
        }, {
            planned: ["docs/specs/editor/html"],
        });

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([]);
    });

    it("拒绝空壳章节、模板占位值和无链接的 implemented 证据", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/empty.md": specDocument({
                capability: "editor.empty",
                body: [
                    ...["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"].map((heading) => `## ${heading}\n\nTODO`),
                    "## 证据\n\n待补",
                ].join("\n\n"),
            }),
            "docs/specs/editor/template-copy.md": specDocument({
                capability: "replace.with-stable-capability",
                owners: ["replace-with-owning-module"],
            }),
            "docs/specs/editor/fake-implemented.md": specDocument({
                capability: "editor.fake-implemented",
                status: "implemented",
                body: [
                    ...["目标与非目标", "术语与参与者", "输入与前置条件", "输出与可观察行为", "状态与转换", "副作用与数据", "失败与恢复", "边界与兼容", "验收与 Smoke"].map((heading) => `## ${heading}\n\n有效说明。`),
                    "## 实现合同\n\n尚未实现",
                    "## 证据\n\n只有口头说明。",
                ].join("\n\n"),
            }),
        }, {
            planned: ["docs/specs/editor/empty.md", "docs/specs/editor/template-copy.md"],
            implemented: ["docs/specs/editor/fake-implemented.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("Behavior Spec 的“目标与非目标”章节没有实义内容：docs/specs/editor/empty.md");
        expect(report.failures).toContain("Planned Spec 的“证据”章节没有实义内容：docs/specs/editor/empty.md");
        expect(report.failures).toContain("Spec capability 仍是模板占位值：docs/specs/editor/template-copy.md");
        expect(report.failures).toContain("Spec owners 仍包含模板占位值：docs/specs/editor/template-copy.md");
        expect(report.failures).toContain("Implemented Spec 的“实现合同”章节没有实义内容：docs/specs/editor/fake-implemented.md");
        expect(report.failures).toContain("Implemented Spec 的“证据”必须链接仓库内实现或验证入口：docs/specs/editor/fake-implemented.md");
    });

    it("拒绝注册目录、治理文件、重复行和反斜杠链接", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/README.md": "# Editor Specs\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
            "docs/standards/windows-link.md": "# Link\n\n[Spec](..\\specs\\editor\\html.md)\n",
        }, {
            planned: ["docs/specs/editor/html.md", "docs/specs/editor/html.md", "docs/specs/editor/README.md", "docs/specs/editor/"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("“待实现规范”重复登记 Spec：docs/specs/editor/html.md");
        expect(report.failures).toContain("“待实现规范”只能登记具体 Spec 文件：docs/specs/README.md -> ../../docs/specs/editor/README.md");
        expect(report.failures).toContain("“待实现规范”只能登记具体 Spec 文件：docs/specs/README.md -> ../../docs/specs/editor/");
        expect(report.failures).toContain("相对链接必须使用正斜杠：docs/standards/windows-link.md -> ..\\specs\\editor\\html.md");
    });

    it("代码块标题不能冒充 Behavior 章节", async () => {
        const fixture = await createDocumentationFixture({
            "docs/specs/editor/code-headings.md": specDocument({
                capability: "editor.code-headings",
                body: "```markdown\n## 目标与非目标\n## 术语与参与者\n## 输入与前置条件\n## 输出与可观察行为\n## 状态与转换\n## 副作用与数据\n## 失败与恢复\n## 边界与兼容\n## 验收与 Smoke\n## 证据\n```\n",
            }),
        }, {
            planned: ["docs/specs/editor/code-headings.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("Behavior Spec 缺少“目标与非目标”章节：docs/specs/editor/code-headings.md");
    });

    it("冻结 Reference 域以注册表为唯一白名单", async () => {
        const fixture = await createDocumentationFixture({
            "reference/new-domain/contract.md": "# Contract\n",
        }, {
            frozen: ["reference/new-domain/"],
        });

        expect(checkDocumentation(fixture.root, fixture.paths).failures).toEqual([]);
    });

    it("只校验新 schema Task 的具体 Spec 绑定和活跃链接", async () => {
        const fixture = await createDocumentationFixture({
            ".agents/tasks/00150-valid/README.md": "---\nschema: nbook.task/v1\n---\n\n# Task\n\n[Spec](../../../docs/specs/editor/html.md)\n",
            ".agents/tasks/00151-no-behavior-change/README.md": "---\nschema: nbook.task/v1\n---\n\n# Task\n\n本任务行为合同未变。\n",
            ".agents/tasks/00152-broken/README.md": "---\nschema: nbook.task/v1\n---\n\n# Task\n\n[Spec](../../../docs/specs/editor/missing.md)\n",
            ".agents/tasks/42-history/README.md": "# Historical Task\n\n[Old](../../../docs/tasks/missing.md)\n",
            "docs/specs/editor/html.md": specDocument({capability: "editor.html"}),
        }, {
            planned: ["docs/specs/editor/html.md"],
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("相对链接目标不存在：.agents/tasks/00152-broken/README.md -> ../../../docs/specs/editor/missing.md（docs/specs/editor/missing.md）");
        expect(report.failures).toContain("新 Task 必须链接具体 Spec，或明确说明“行为合同未变”：.agents/tasks/00152-broken/README.md");
        expect(report.failures.some((failure) => failure.includes("42-history"))).toBe(false);
        expect(report.failures.some((failure) => failure.includes("00150-valid"))).toBe(false);
        expect(report.failures.some((failure) => failure.includes("00151-no-behavior-change"))).toBe(false);
    });

    it("图片链接和路径大小写使用受管文件集合校验", async () => {
        const fixture = await createDocumentationFixture({
            "docs/standards/assets.md": "# Assets\n\n![Missing](images/missing.png)\n\n[Wrong case](README.MD)\n",
            "docs/standards/images/present.png": "image",
        });

        const report = checkDocumentation(fixture.root, fixture.paths);

        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> images/missing.png（docs/standards/images/missing.png）");
        expect(report.failures).toContain("相对链接目标不存在：docs/standards/assets.md -> README.MD（docs/standards/README.MD）");
    });
});

async function createDocumentationFixture(
    extraFiles: Readonly<Record<string, string>>,
    registered: {planned?: readonly string[]; implemented?: readonly string[]; frozen?: readonly string[]} = {},
): Promise<{root: string; paths: string[]}> {
    const root = await createTestTmpRoot("documentation-governance", "documentation-governance-test");
    fixtureRoots.push(root);
    const files: Record<string, string> = Object.fromEntries(REQUIRED_INDEXES.map((path) => [path, `# ${path}\n`]));
    const implementedRows = (registered.implemented ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    const plannedRows = (registered.planned ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    const frozenRows = (registered.frozen ?? []).map((path) => `| Test | [Reference](../../${path}) | docs/specs/test/ |`).join("\n");
    files["docs/specs/README.md"] = SPEC_REGISTRY
        .replace("|---|---|---|\n\n## 待实现规范", `|---|---|---|\n${implementedRows}\n\n## 待实现规范`)
        .replace("|---|---|---|\n\n## 冻结过渡规范", `|---|---|---|\n${plannedRows}\n\n## 冻结过渡规范`)
        .replace(/(## 冻结过渡规范\n\n\| 功能域 \| 当前规范 \| 固定目标 \|\n\|---\|---\|---\|)/u, `$1\n${frozenRows}`);
    Object.assign(files, extraFiles);
    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = join(root, relativePath);
        await mkdir(dirname(absolutePath), {recursive: true});
        await writeFile(absolutePath, content, "utf8");
    }));
    return {root, paths: Object.keys(files).sort()};
}
