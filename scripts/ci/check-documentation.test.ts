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

function specDocument(options: {capability: string; status?: "planned" | "implemented"; body?: string}): string {
    const status = options.status ?? "planned";
    return `---
schema: nbook.spec/v1
kind: behavior
status: ${status}
capability: ${options.capability}
owners:
  - test-module
---

# Test Spec

${options.body ?? [
        "## 目标与非目标",
        "## 术语与参与者",
        "## 输入与前置条件",
        "## 输出与可观察行为",
        "## 状态与转换",
        "## 副作用与数据",
        "## 失败与恢复",
        "## 边界与兼容",
        "## 验收与 Smoke",
    ].join("\n\n")}
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
});

async function createDocumentationFixture(
    extraFiles: Readonly<Record<string, string>>,
    registered: {planned?: readonly string[]; implemented?: readonly string[]} = {},
): Promise<{root: string; paths: string[]}> {
    const root = await createTestTmpRoot("documentation-governance", "documentation-governance-test");
    fixtureRoots.push(root);
    const files: Record<string, string> = Object.fromEntries(REQUIRED_INDEXES.map((path) => [path, `# ${path}\n`]));
    const implementedRows = (registered.implemented ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    const plannedRows = (registered.planned ?? []).map((path) => `| Test | [Spec](../../${path}) | Test |`).join("\n");
    files["docs/specs/README.md"] = SPEC_REGISTRY
        .replace("|---|---|---|\n\n## 待实现规范", `|---|---|---|\n${implementedRows}\n\n## 待实现规范`)
        .replace("|---|---|---|\n\n## 冻结过渡规范", `|---|---|---|\n${plannedRows}\n\n## 冻结过渡规范`);
    Object.assign(files, extraFiles);
    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
        const absolutePath = join(root, relativePath);
        await mkdir(dirname(absolutePath), {recursive: true});
        await writeFile(absolutePath, content, "utf8");
    }));
    return {root, paths: Object.keys(files).sort()};
}
