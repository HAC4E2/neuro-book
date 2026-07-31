import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parse} from "yaml";

import {readLabelManifest} from "nbook/scripts/ci/community-labels";

interface FormOption {
    label: string;
    required?: boolean;
}

interface FormField {
    type: string;
    id?: string;
    attributes?: {
        label?: string;
        options?: FormOption[];
    };
    validations?: {
        required?: boolean;
    };
}

interface IssueForm {
    name: string;
    description: string;
    labels: string[];
    body: FormField[];
}

interface IssueTemplateConfig {
    blank_issues_enabled: boolean;
    contact_links?: Array<{
        name: string;
        url: string;
        about: string;
    }>;
}

interface FormContract {
    path: string;
    typeLabel: string;
    requiredLabels?: string[];
    requiredIds: string[];
}

interface WorkflowStep {
    name?: string;
    run?: string;
}

interface WorkflowJob {
    name?: string;
    "timeout-minutes"?: number;
    steps?: WorkflowStep[];
}

interface WorkflowConfig {
    name: string;
    on: {
        pull_request?: {
            paths?: string[];
        };
    };
    permissions: Record<string, string>;
    jobs: Record<string, WorkflowJob>;
}

const root = resolve(import.meta.dir, "../..");

const formContracts: FormContract[] = [
    {
        path: ".github/ISSUE_TEMPLATE/bug-report.yml",
        typeLabel: "type: bug",
        requiredIds: [
            "version",
            "installation",
            "operating-system",
            "architecture",
            "reproducibility",
            "steps",
            "actual-result",
            "expected-result",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/feature-request.yml",
        typeLabel: "type: feature",
        requiredIds: [
            "problem",
            "desired-outcome",
            "current-workaround",
            "target-users",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/support-request.yml",
        typeLabel: "type: support",
        requiredIds: [
            "question",
            "version",
            "installation",
            "environment",
            "attempted",
            "current-result",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/prompt-contribution.yml",
        typeLabel: "type: feature",
        requiredLabels: ["area: agent"],
        requiredIds: [
            "contribution-kind",
            "asset-kind",
            "target",
            "use-case",
            "desired-behavior",
            "content-authorization",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
    {
        path: ".github/ISSUE_TEMPLATE/other-request.yml",
        typeLabel: "type: other",
        requiredIds: [
            "topic",
            "why-other",
            "details",
            "privacy-confirmation",
            "duplicate-check",
        ],
    },
];

const yamlPaths = [
    ".github/labels.yml",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/ISSUE_TEMPLATE/support-request.yml",
    ".github/ISSUE_TEMPLATE/prompt-contribution.yml",
    ".github/ISSUE_TEMPLATE/other-request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/workflows/community-docs.yml",
    ".github/workflows/code-baseline.yml",
    ".github/workflows/deploy-docs.yml",
];

const codeBaselinePaths = [
    "app/**",
    "assets/**",
    "packages/**",
    "plugins/**",
    "prisma/**",
    "scripts/**",
    "server/**",
    "shared/**",
    "world-engine/**",
    "*.d.ts",
    ".env.example",
    ".env.docker.example",
    "Dockerfile*",
    "bunfig.toml",
    "config.example.yaml",
    "docker-compose*.yml",
    "nuxt.config.ts",
    "prisma.config.ts",
    "release-state-migration.json",
    "tsconfig.json",
    "uno.config.ts",
    "vitest.config.ts",
    "package.json",
    "bun.lock",
    ".github/workflows/code-baseline.yml",
];

/** 读取仓库内的 UTF-8 文本文件。 */
async function readRepoFile(path: string): Promise<string> {
    return await readFile(resolve(root, path), "utf8");
}

/** 解析受版本控制的 YAML 配置。 */
async function readYaml<T>(path: string): Promise<T> {
    return parse(await readRepoFile(path)) as T;
}

/** 在社区配置违反明确合同时终止校验。 */
function ensure(condition: boolean, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

/** 验证标签名称、颜色和描述可以作为仓库标签真相源。 */
async function validateLabels(): Promise<Set<string>> {
    const labels = await readLabelManifest(resolve(root, ".github/labels.yml"));
    return new Set(labels.map((label) => label.name));
}

/** 判断表单字段是否通过字段级或 checkbox option 声明为必填。 */
function isRequired(field: FormField): boolean {
    if (field.validations?.required === true) {
        return true;
    }
    return field.type === "checkboxes"
        && Boolean(field.attributes?.options?.some((option) => option.required === true));
}

/** 验证 Issue Form 的标签引用、字段 ID、必填字段和隐私确认。 */
async function validateForm(contract: FormContract, labelNames: Set<string>): Promise<void> {
    const form = await readYaml<IssueForm>(contract.path);
    ensure(Boolean(form.name) && Boolean(form.description), `${contract.path} 缺少 name 或 description`);
    ensure(form.labels.filter((label) => label.startsWith("type: ")).length === 1, `${contract.path} 必须恰好引用一个 type:* 标签`);
    ensure(form.labels.filter((label) => label.startsWith("status: ")).length === 1, `${contract.path} 必须恰好引用一个 status:* 标签`);
    ensure(form.labels.includes(contract.typeLabel), `${contract.path} 缺少 ${contract.typeLabel}`);
    ensure(form.labels.includes("status: needs-triage"), `${contract.path} 缺少 status: needs-triage`);
    for (const label of contract.requiredLabels ?? []) {
        ensure(form.labels.includes(label), `${contract.path} 缺少 ${label}`);
    }

    for (const label of form.labels) {
        ensure(labelNames.has(label), `${contract.path} 引用了未登记标签: ${label}`);
    }

    const ids = new Set<string>();
    for (const field of form.body) {
        if (!field.id) {
            continue;
        }
        ensure(!ids.has(field.id), `${contract.path} 字段 ID 重复: ${field.id}`);
        ids.add(field.id);
    }

    for (const id of contract.requiredIds) {
        const field = form.body.find((candidate) => candidate.id === id);
        ensure(Boolean(field), `${contract.path} 缺少字段: ${id}`);
        ensure(isRequired(field!), `${contract.path} 字段必须为必填: ${id}`);
    }

    const privacy = form.body.find((field) => field.id === "privacy-confirmation");
    ensure(privacy?.type === "checkboxes", `${contract.path} 隐私确认必须使用 checkboxes`);
    ensure(Boolean(privacy.attributes?.label?.includes("隐私")), `${contract.path} 隐私确认缺少中文标识`);
    ensure(Boolean(privacy.attributes?.label?.includes("Privacy")), `${contract.path} 隐私确认缺少英文标识`);
}

/** 验证中英文贡献指南保持相同章节数和互相链接。 */
async function validateGuides(): Promise<void> {
    const chinese = await readRepoFile("CONTRIBUTING.md");
    const english = await readRepoFile("CONTRIBUTING.en.md");
    ensure(chinese.includes("[English](CONTRIBUTING.en.md)"), "中文贡献指南必须链接英文镜像");
    ensure(english.includes("[中文](CONTRIBUTING.md)"), "英文贡献指南必须链接中文主入口");

    const chineseHeadings = chinese.match(/^## .+$/gm) ?? [];
    const englishHeadings = english.match(/^## .+$/gm) ?? [];
    ensure(chineseHeadings.length === 10, `中文贡献指南应有 10 个二级章节，实际 ${chineseHeadings.length}`);
    ensure(englishHeadings.length === chineseHeadings.length, "中英文贡献指南二级章节数量不一致");
    for (const phrase of [
        "needs-triage",
        "needs-info",
        "needs-design",
        "status: ready",
        "status: blocked",
        "help wanted",
        "good first issue",
    ]) {
        ensure(chinese.includes(phrase), `中文贡献指南缺少分流合同: ${phrase}`);
        ensure(english.includes(phrase), `英文贡献指南缺少分流合同: ${phrase}`);
    }
}

/** 验证公开 Issue 配置、PR 模板和安全政策的关键入口。 */
async function validatePublicTemplates(): Promise<void> {
    const config = await readYaml<IssueTemplateConfig>(".github/ISSUE_TEMPLATE/config.yml");
    ensure(config.blank_issues_enabled === false, "Issue 配置必须禁止空白 Issue");
    const duplicateSecurityLinks = (config.contact_links ?? [])
        .filter((link) => link.url.includes("/security/advisories"));
    ensure(duplicateSecurityLinks.length === 0, "Issue chooser 不得重复配置私密安全报告入口；GitHub 会提供原生 Security 入口");

    const pullRequest = await readRepoFile(".github/PULL_REQUEST_TEMPLATE.md");
    for (const heading of [
        "## 关联 Issue / Related issue",
        "## 本次范围 / Scope",
        "## 验证 / Verification",
        "## 文档与记录 / Documentation and records",
        "## 风险与边界 / Risks and boundaries",
        "## 提交者确认 / Contributor confirmation",
    ]) {
        ensure(pullRequest.includes(heading), `PR 模板缺少章节: ${heading}`);
    }
    ensure(pullRequest.includes("无 / None"), "PR 模板必须允许轻量文档修正不关联 Issue");

    const security = await readRepoFile(".github/SECURITY.md");
    ensure(security.includes("Private Vulnerability Reporting"), "安全政策必须说明私密漏洞报告");
    ensure(security.includes("/security/advisories/new"), "安全政策必须链接私密漏洞报告入口");
}

/** 取得工作流 job 的 run 命令列表。 */
function jobCommands(job: WorkflowJob | undefined, label: string): readonly string[] {
    ensure(Boolean(job), `工作流缺少 job: ${label}`);
    ensure(Array.isArray(job!.steps), `工作流 job 缺少 steps: ${label}`);
    return job!.steps!.flatMap((step) => step.run ? [step.run] : []);
}

/** 验证若干命令存在并保持给定顺序。 */
function ensureCommandOrder(commands: readonly string[], expected: readonly string[], label: string): void {
    let previousIndex = -1;
    for (const command of expected) {
        const index = commands.indexOf(command);
        ensure(index > previousIndex, `${label} 缺少命令或顺序错误: ${command}`);
        previousIndex = index;
    }
}

/** 验证社区、文档部署和代码基线工作流的稳定合同。 */
async function validateWorkflows(): Promise<void> {
    const community = await readYaml<WorkflowConfig>(".github/workflows/community-docs.yml");
    ensure(community.permissions.contents === "read", "Community workflow 必须保持 contents: read");
    ensure(Object.keys(community.permissions).length === 1, "Community workflow 不得获得写权限");
    const communityJob = community.jobs["community-docs"];
    ensure(communityJob?.["timeout-minutes"] === 15, "Community workflow 超时必须为 15 分钟");
    ensureCommandOrder(jobCommands(communityJob, "community-docs"), [
        "bun install --frozen-lockfile",
        "bun run nuxt:prepare",
        "bun scripts/ci/validate-community-files.ts",
        "bun run docs:build",
    ], "Community workflow");

    const deployDocs = await readYaml<WorkflowConfig>(".github/workflows/deploy-docs.yml");
    ensure(deployDocs.permissions.contents === "read", "Deploy Docs 必须保持 contents: read");
    ensure(deployDocs.permissions.pages === "write", "Deploy Docs 必须声明 pages: write");
    ensure(deployDocs.permissions["id-token"] === "write", "Deploy Docs 必须声明 id-token: write");
    const deployBuild = deployDocs.jobs.build;
    ensure(deployBuild?.["timeout-minutes"] === 15, "Deploy Docs build 超时必须为 15 分钟");
    ensure(deployDocs.jobs.deploy?.["timeout-minutes"] === 10, "Deploy Docs deploy 超时必须为 10 分钟");
    ensureCommandOrder(jobCommands(deployBuild, "deploy-docs/build"), [
        "bun install --frozen-lockfile",
        "bun run nuxt:prepare",
        "bun run docs:build",
    ], "Deploy Docs");

    const baseline = await readYaml<WorkflowConfig>(".github/workflows/code-baseline.yml");
    ensure(baseline.name === "Code Baseline (Advisory)", "Code Baseline 必须明确标记 Advisory");
    ensure(baseline.permissions.contents === "read", "Code Baseline 必须保持 contents: read");
    ensure(Object.keys(baseline.permissions).length === 1, "Code Baseline 不得获得写权限");
    const paths = baseline.on.pull_request?.paths ?? [];
    for (const path of codeBaselinePaths) {
        ensure(paths.includes(path), `Code Baseline 缺少 paths 合同: ${path}`);
    }

    const typecheck = baseline.jobs.typecheck;
    const test = baseline.jobs.test;
    ensure(typecheck?.name?.includes("advisory") === true, "Typecheck job 必须标记 advisory");
    ensure(test?.name?.includes("advisory") === true, "Test job 必须标记 advisory");
    ensure(typecheck?.["timeout-minutes"] === 15, "Typecheck 超时必须为 15 分钟");
    ensure(test?.["timeout-minutes"] === 30, "Full tests 超时必须为 30 分钟");
    ensure(jobCommands(typecheck, "code-baseline/typecheck").includes("bun run typecheck"), "缺少 typecheck 命令");
    ensure(jobCommands(test, "code-baseline/test").includes("bun run test -- --reporter=dot"), "缺少全量测试命令");
}

/** 解析所有新增 YAML，提前发现 GitHub 无法读取的配置。 */
async function validateYaml(): Promise<void> {
    for (const path of yamlPaths) {
        await readYaml<object>(path);
    }
}

/** 执行贡献体系静态合同校验。 */
async function main(): Promise<void> {
    await validateYaml();
    const labelNames = await validateLabels();
    for (const contract of formContracts) {
        await validateForm(contract, labelNames);
    }
    await validateGuides();
    await validatePublicTemplates();
    await validateWorkflows();
    console.log(`贡献体系校验通过：${labelNames.size} 个标签、${formContracts.length} 个 Issue Form、${yamlPaths.length} 个 YAML。`);
}

await main();
