#!/usr/bin/env bun
import {existsSync, lstatSync, readFileSync} from "node:fs";
import {resolve} from "node:path";
import {posix} from "node:path";
import type {Nodes, Root} from "mdast";
import {fromMarkdown} from "mdast-util-from-markdown";
import {parse as parseYaml} from "yaml";

import {defaultRepoRoot, git} from "nbook/scripts/ci/agent-governance-contract";

export type DocumentationCheckReport = {
    failures: string[];
    checkedFiles: number;
};

const REQUIRED_DOC_INDEXES = [
    "docs/specs/README.md",
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
const REQUIRED_SPEC_GOVERNANCE = ["docs/AGENTS.md", "docs/specs/AGENTS.md", "docs/specs/TEMPLATE.md"] as const;
const SPEC_SUPPORT_FILES = new Set(["docs/specs/README.md", ...REQUIRED_SPEC_GOVERNANCE]);
const SPEC_KINDS = new Set(["behavior", "architecture", "glossary"]);
const SPEC_STATUSES = new Set(["planned", "implemented"]);
const BEHAVIOR_SPEC_HEADINGS = [
    "目标与非目标",
    "术语与参与者",
    "输入与前置条件",
    "输出与可观察行为",
    "状态与转换",
    "副作用与数据",
    "失败与恢复",
    "边界与兼容",
    "验收与 Smoke",
] as const;

type SpecMetadata = {
    kind: string;
    status: string;
    capability: string;
};

const FROZEN_REFERENCE_DOMAINS: Record<string, true> = {
    agent: true,
    content: true,
    "world-engine": true,
    plot: true,
    theme: true,
    media: true,
};
const ROOT_DOCUMENTS: Record<string, true> = {
    "AGENTS.md": true,
    "CLAUDE.md": true,
    "CONTEXT.md": true,
    "CONTRIBUTING.md": true,
    "CONTRIBUTING.en.md": true,
    "PROJECT-STATUS.md": true,
    "README.md": true,
    "README.en.md": true,
    "RELEASE.md": true,
    "WATCHDOG.md": true,
};

export function checkDocumentation(repoRoot: string, paths?: readonly string[]): DocumentationCheckReport {
    const normalizedRoot = resolve(repoRoot);
    const candidates = paths ?? git(normalizedRoot, ["ls-files", "--cached", "--others", "--exclude-standard"])
        .split(/\r?\n/u)
        .filter(Boolean);
    const files = [...new Set(candidates.map(normalizeRepoPath))]
        .filter((path) => isRegularFile(normalizedRoot, path))
        .sort();
    const fileSet = new Set(files);
    const failures: string[] = [];

    checkRequiredIndexes(fileSet, failures);
    checkDocsRoot(files, failures);
    checkRetiredDocumentationPaths(files, failures);
    checkAdrs(normalizedRoot, files, failures);
    checkActiveLinks(normalizedRoot, files, fileSet, failures);
    checkSpecRegistry(normalizedRoot, fileSet, failures);
    checkSpecs(normalizedRoot, files, failures);
    checkFrozenReference(files, failures);

    return {failures, checkedFiles: files.length};
}


function normalizeRepoPath(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isRegularFile(repoRoot: string, path: string): boolean {
    const absolutePath = resolve(repoRoot, path);
    if (!existsSync(absolutePath)) return false;
    const stats = lstatSync(absolutePath);
    return stats.isFile() && !stats.isSymbolicLink();
}

function checkRequiredIndexes(fileSet: ReadonlySet<string>, failures: string[]): void {
    if (!fileSet.has("docs/README.md")) failures.push("缺少文档治理入口：docs/README.md");
    for (const path of REQUIRED_DOC_INDEXES) {
        if (!fileSet.has(path)) failures.push(`文档分类缺少 README：${path}`);
    }
    for (const path of REQUIRED_SPEC_GOVERNANCE) {
        if (!fileSet.has(path)) failures.push(`缺少 Spec 治理文件：${path}`);
    }
}

function checkDocsRoot(files: readonly string[], failures: string[]): void {
    for (const path of files) {
        if (/^docs\/[^/]+\.md$/u.test(path) && path !== "docs/README.md" && path !== "docs/AGENTS.md") {
            failures.push(`docs 根层只允许 README.md 和 AGENTS.md：${path}`);
        }
    }
}

function checkRetiredDocumentationPaths(files: readonly string[], failures: string[]): void {
    for (const path of files.filter((candidate) => candidate.startsWith("docs/manual-eval/"))) {
        failures.push(`人工评测已迁入 docs/testing/manual-eval：${path}`);
    }
}

function checkAdrs(repoRoot: string, files: readonly string[], failures: string[]): void {
    const byNumber = new Map<string, string[]>();
    for (const path of files.filter((candidate) => candidate.startsWith("docs/adr/") && candidate.endsWith(".md") && candidate !== "docs/adr/README.md")) {
        const filename = path.slice("docs/adr/".length);
        const match = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.exec(filename);
        if (!match) {
            failures.push(`ADR 文件名必须为 NNNN-kebab-case.md：${path}`);
            continue;
        }
        const number = match[1];
        const sameNumber = byNumber.get(number) ?? [];
        sameNumber.push(path);
        byNumber.set(number, sameNumber);
        const heading = readFileSync(resolve(repoRoot, path), "utf8").match(/^# ADR (\d{4})(?:\b|：)/mu)?.[1];
        if (heading !== number) failures.push(`ADR 标题编号与文件名不一致：${path}（标题 ${heading ?? "缺失"}，文件名 ${number}）`);
    }
    for (const [number, paths] of byNumber) {
        if (paths.length > 1) failures.push(`ADR 编号重复 ${number}：${paths.join(", ")}`);
    }
}

function checkActiveLinks(repoRoot: string, files: readonly string[], fileSet: ReadonlySet<string>, failures: string[]): void {
    for (const source of files.filter(isActiveMarkdown)) {
        const text = readFileSync(resolve(repoRoot, source), "utf8");
        let tree: Root;
        try {
            tree = fromMarkdown(text);
        } catch (error) {
            failures.push(`Markdown 无法解析：${source}：${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        for (const url of collectLinkUrls(tree)) {
            const target = resolveRelativeLink(source, url);
            if (target === null) continue;
            if (target.startsWith("../") || target === "..") {
                failures.push(`相对链接越出仓库：${source} -> ${url}`);
                continue;
            }
            if (!linkTargetExists(repoRoot, target, fileSet)) failures.push(`相对链接目标不存在：${source} -> ${url}（${target}）`);
        }
    }
}

function isActiveMarkdown(path: string): boolean {
    if (!path.endsWith(".md")) return false;
    if (ROOT_DOCUMENTS[path] || path === ".omp/RULES.md") return true;
    if (path.startsWith("docs/")) return !path.startsWith("docs/archived/") && !path.startsWith("docs/research/");
    if (path.startsWith("reference/")) return true;
    if (path.startsWith("vitepress/")) return !path.startsWith("vitepress/changelog/")
        && !path.startsWith("vitepress/en/changelog/")
        && !path.startsWith("vitepress/public/");
    if (path === ".agents/README.md" || path === ".agents/AGENTS.md") return true;
    return path.startsWith(".agents/roles/") || path.startsWith(".agents/skills/");
}

function collectLinkUrls(tree: Root): string[] {
    const urls: string[] = [];
    const visit = (node: Nodes | Root): void => {
        if (node.type === "link" || node.type === "definition") urls.push(node.url);
        if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return urls;
}

function resolveRelativeLink(source: string, rawUrl: string): string | null {
    const url = rawUrl.trim();
    if (!url || url.startsWith("#") || url.startsWith("/") || url.startsWith("//")) return null;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(url)) return null;
    const withoutFragment = url.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(withoutFragment);
    } catch {
        decoded = withoutFragment;
    }
    return posix.normalize(posix.join(posix.dirname(source), decoded));
}

function linkTargetExists(repoRoot: string, target: string, fileSet: ReadonlySet<string>): boolean {
    const candidates = [target];
    if (!target.endsWith(".md")) candidates.push(`${target}.md`);
    candidates.push(`${target}/README.md`, `${target}/index.md`);
    if (candidates.some((candidate) => fileSet.has(normalizeRepoPath(candidate)))) return true;
    return candidates.some((candidate) => {
        const absolutePath = resolve(repoRoot, candidate);
        return existsSync(absolutePath) && !lstatSync(absolutePath).isSymbolicLink();
    });
}

function checkSpecRegistry(repoRoot: string, fileSet: ReadonlySet<string>, failures: string[]): void {
    const registryPath = "docs/specs/README.md";
    if (!fileSet.has(registryPath)) return;
    const text = readFileSync(resolve(repoRoot, registryPath), "utf8");
    const frozenSection = markdownSection(text, "冻结过渡规范");
    if (frozenSection === null) failures.push(`${registryPath} 缺少“冻结过渡规范”章节`);
    for (const url of collectLinkUrls(fromMarkdown(frozenSection ?? ""))) {
        const target = resolveRelativeLink(registryPath, url);
        if (target === null) continue;
        if (["docs/proposals/", "docs/research/", "docs/archived/", ".agents/tasks/"].some((prefix) => target.startsWith(prefix))) {
            failures.push(`冻结过渡规范指向非规范资料：${registryPath} -> ${url}（${target}）`);
        }
    }
}

function checkSpecs(repoRoot: string, files: readonly string[], failures: string[]): void {
    const registryPath = "docs/specs/README.md";
    if (!files.includes(registryPath)) return;
    const registry = readFileSync(resolve(repoRoot, registryPath), "utf8");
    const implementedTargets = registeredSpecTargets(registryPath, registry, "已实现规范", failures);
    const plannedTargets = registeredSpecTargets(registryPath, registry, "待实现规范", failures);
    const byCapability = new Map<string, string[]>();

    for (const path of files.filter((candidate) => candidate.startsWith("docs/specs/") && candidate.endsWith(".md") && !SPEC_SUPPORT_FILES.has(candidate))) {
        const text = readFileSync(resolve(repoRoot, path), "utf8");
        const metadata = parseSpecMetadata(path, text, failures);
        if (metadata === null) continue;
        const sameCapability = byCapability.get(metadata.capability) ?? [];
        sameCapability.push(path);
        byCapability.set(metadata.capability, sameCapability);

        const expectedTargets = metadata.status === "implemented" ? implementedTargets : plannedTargets;
        const expectedSection = metadata.status === "implemented" ? "已实现规范" : "待实现规范";
        const otherTargets = metadata.status === "implemented" ? plannedTargets : implementedTargets;
        if (!expectedTargets.has(path)) failures.push(`Spec 未登记在“${expectedSection}”：${path}`);
        if (otherTargets.has(path)) failures.push(`Spec 登记的成熟度与 frontmatter 不一致：${path}（${metadata.status}）`);

        if (metadata.kind === "behavior") {
            const headings = new Set([...text.matchAll(/^## (.+)$/gmu)].map((match) => match[1].trim()));
            for (const heading of BEHAVIOR_SPEC_HEADINGS) {
                if (!headings.has(heading)) failures.push(`Behavior Spec 缺少“${heading}”章节：${path}`);
            }
            if (metadata.status === "implemented") {
                for (const heading of ["实现合同", "证据"] as const) {
                    if (!headings.has(heading)) failures.push(`Implemented Spec 缺少“${heading}”章节：${path}`);
                }
            }
        }
    }

    for (const [capability, paths] of byCapability) {
        if (paths.length > 1) failures.push(`Spec capability 重复 ${capability}：${paths.join(", ")}`);
    }
}

function markdownSection(text: string, heading: string): string | null {
    const marker = `## ${heading}`;
    const start = text.indexOf(marker);
    if (start < 0) return null;
    const next = text.indexOf("\n## ", start + marker.length);
    return text.slice(start, next >= 0 ? next : undefined);
}

function registeredSpecTargets(registryPath: string, registry: string, heading: string, failures: string[]): ReadonlySet<string> {
    const section = markdownSection(registry, heading);
    if (section === null) {
        failures.push(`${registryPath} 缺少“${heading}”章节`);
        return new Set();
    }
    return new Set(collectLinkUrls(fromMarkdown(section))
        .map((url) => resolveRelativeLink(registryPath, url))
        .filter((target): target is string => target !== null && target.startsWith("docs/specs/") && target.endsWith(".md")));
}

function parseSpecMetadata(path: string, text: string, failures: string[]): SpecMetadata | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
    if (!match) {
        failures.push(`Spec 缺少 YAML frontmatter：${path}`);
        return null;
    }
    let raw: unknown;
    try {
        raw = parseYaml(match[1]);
    } catch (error) {
        failures.push(`Spec frontmatter 无法解析：${path}：${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        failures.push(`Spec frontmatter 必须是对象：${path}`);
        return null;
    }
    const fields = raw as Record<string, unknown>;
    const schema = fields.schema;
    const kind = fields.kind;
    const status = fields.status;
    const capability = fields.capability;
    const owners = fields.owners;
    if (schema !== "nbook.spec/v1") failures.push(`Spec schema 必须是 nbook.spec/v1：${path}`);
    if (typeof kind !== "string" || !SPEC_KINDS.has(kind)) failures.push(`Spec kind 必须是 behavior、architecture 或 glossary：${path}`);
    if (typeof status !== "string" || !SPEC_STATUSES.has(status)) failures.push(`Spec status 必须是 planned 或 implemented：${path}`);
    if (typeof capability !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)) failures.push(`Spec capability 必须是稳定的点分小写标识：${path}`);
    if (!Array.isArray(owners) || owners.length === 0 || owners.some((owner) => typeof owner !== "string" || !owner.trim())) {
        failures.push(`Spec owners 必须是非空模块列表：${path}`);
    }
    if (schema !== "nbook.spec/v1" || typeof kind !== "string" || !SPEC_KINDS.has(kind)
        || typeof status !== "string" || !SPEC_STATUSES.has(status)
        || typeof capability !== "string" || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u.test(capability)
        || !Array.isArray(owners) || owners.length === 0 || owners.some((owner) => typeof owner !== "string" || !owner.trim())) return null;
    return {kind, status, capability};
}

function checkFrozenReference(files: readonly string[], failures: string[]): void {
    for (const path of files.filter((candidate) => candidate.startsWith("reference/") && candidate.endsWith(".md"))) {
        const segments = path.split("/");
        if (path === "reference/README.md") continue;
        if (segments[1] === "workspace") {
            failures.push(`已迁移的 reference/workspace 不得重新出现：${path}`);
            continue;
        }
        if (!FROZEN_REFERENCE_DOMAINS[segments[1]]) failures.push(`reference 出现未登记顶层域：${path}`);
    }
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const repoArgument = args.indexOf("--repo-root");
    const repoRoot = resolve(repoArgument >= 0 ? args[repoArgument + 1] ?? "" : defaultRepoRoot(import.meta.url));
    const report = checkDocumentation(repoRoot);
    console.log(JSON.stringify(report, null, 2));
    if (report.failures.length > 0) process.exitCode = 1;
}
