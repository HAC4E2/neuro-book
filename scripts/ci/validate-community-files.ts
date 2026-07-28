import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {parse} from "yaml";

interface LabelEntry {
    name: string;
    color: string;
    description: string;
}

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
    contact_links: Array<{
        name: string;
        url: string;
        about: string;
    }>;
}

interface FormContract {
    path: string;
    typeLabel: string;
    requiredIds: string[];
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
];

const yamlPaths = [
    ".github/labels.yml",
    ".github/ISSUE_TEMPLATE/bug-report.yml",
    ".github/ISSUE_TEMPLATE/feature-request.yml",
    ".github/ISSUE_TEMPLATE/support-request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/workflows/community-docs.yml",
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
    const labels = await readYaml<LabelEntry[]>(".github/labels.yml");
    ensure(Array.isArray(labels) && labels.length > 0, ".github/labels.yml 必须包含标签列表");

    const names = new Set<string>();
    for (const label of labels) {
        ensure(Boolean(label.name), "每个标签必须有 name");
        ensure(!names.has(label.name), `标签名称重复: ${label.name}`);
        ensure(/^[0-9A-F]{6}$/.test(label.color), `标签颜色必须是六位大写十六进制: ${label.name}`);
        ensure(label.description.includes(" / "), `标签描述必须中英双语: ${label.name}`);
        names.add(label.name);
    }

    return names;
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
    ensure(form.labels.includes(contract.typeLabel), `${contract.path} 缺少 ${contract.typeLabel}`);
    ensure(form.labels.includes("status: needs-triage"), `${contract.path} 缺少 status: needs-triage`);

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
}

/** 验证公开 Issue 配置、PR 模板和安全政策的关键入口。 */
async function validatePublicTemplates(): Promise<void> {
    const config = await readYaml<IssueTemplateConfig>(".github/ISSUE_TEMPLATE/config.yml");
    ensure(config.blank_issues_enabled === false, "Issue 配置必须禁止空白 Issue");
    const securityLink = config.contact_links.find((link) => link.url.endsWith("/security/advisories/new"));
    ensure(Boolean(securityLink), "Issue 配置必须提供私密安全报告入口");
    ensure(securityLink!.name.includes("安全") && securityLink!.name.includes("Security"), "安全入口必须中英双语");

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

    const security = await readRepoFile(".github/SECURITY.md");
    ensure(security.includes("Private Vulnerability Reporting"), "安全政策必须说明私密漏洞报告");
    ensure(security.includes("/security/advisories/new"), "安全政策必须链接私密漏洞报告入口");
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
    console.log(`贡献体系校验通过：${labelNames.size} 个标签、${formContracts.length} 个 Issue Form、${yamlPaths.length} 个 YAML。`);
}

await main();
