import fs from "node:fs/promises";
import path from "node:path";
import * as yaml from "yaml";
import {
    initProjectDatabaseAtRoot,
    PROJECT_DATABASE_RELATIVE_PATH,
} from "nbook/server/workspace-files/project-workspace";

type CliOptions = {
    workspaceRoot: string;
    apply: boolean;
    overwriteManifest: boolean;
};

type LegacyWorkspaceManifest = {
    displayName?: unknown;
    slug?: unknown;
};

type ProjectAction = {
    projectName: string;
    projectRoot: string;
    projectYamlPath: string;
    projectDatabasePath: string;
    title: string;
    summary: string;
    hasProjectYaml: boolean;
    hasProjectDatabase: boolean;
};

/** 将现有 Project Workspace 目录规范化为 project.yaml + Project SQLite 结构。 */
async function main(): Promise<void> {
    const options = parseCliOptions(process.argv.slice(2));
    const workspaceRoot = path.resolve(process.cwd(), options.workspaceRoot);
    await assertDirectory(workspaceRoot, "Workspace Root 不存在");

    const actions = await collectProjectActions(workspaceRoot);
    if (actions.length === 0) {
        console.log(`${displayPath(workspaceRoot)} 下没有可迁移的 Project Workspace。`);
        return;
    }

    console.log(`${options.apply ? "执行" : "预演"} Project Workspace 规范化：${displayPath(workspaceRoot)}`);
    if (!options.apply) {
        console.log("当前是 dry-run，不会写入文件。确认无误后加 --apply 执行。");
    }

    for (const action of actions) {
        await runAction(action, options);
    }
}

async function collectProjectActions(workspaceRoot: string): Promise<ProjectAction[]> {
    const entries = await fs.readdir(workspaceRoot, {withFileTypes: true});
    const actions: ProjectAction[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
            continue;
        }

        const projectRoot = path.join(workspaceRoot, entry.name);
        if (!await looksLikeProjectWorkspace(projectRoot)) {
            continue;
        }

        const projectYamlPath = path.join(projectRoot, "project.yaml");
        const legacyManifestPath = path.join(projectRoot, "workspace.yaml");
        const projectDatabasePath = path.join(projectRoot, PROJECT_DATABASE_RELATIVE_PATH);
        const existingProjectManifest = await readYamlFile<{title?: unknown; summary?: unknown}>(projectYamlPath);
        const legacyManifest = await readYamlFile<LegacyWorkspaceManifest>(legacyManifestPath);
        const title = normalizeTitle(existingProjectManifest?.title, legacyManifest?.displayName, entry.name);
        const summary = typeof existingProjectManifest?.summary === "string" ? existingProjectManifest.summary : "";

        actions.push({
            projectName: entry.name,
            projectRoot,
            projectYamlPath,
            projectDatabasePath,
            title,
            summary,
            hasProjectYaml: await fileExists(projectYamlPath),
            hasProjectDatabase: await fileExists(projectDatabasePath),
        });
    }

    return actions.sort((left, right) => left.projectName.localeCompare(right.projectName));
}

async function looksLikeProjectWorkspace(projectRoot: string): Promise<boolean> {
    const markers = ["project.yaml", "workspace.yaml", "manuscript", "lorebook", "AGENTS.md", "PROJECT-STATUS.md"];
    for (const marker of markers) {
        if (await fileExists(path.join(projectRoot, marker))) {
            return true;
        }
    }
    return false;
}

async function runAction(action: ProjectAction, options: CliOptions): Promise<void> {
    console.log(`\n- workspace/${action.projectName}`);
    console.log(`  title: ${action.title}`);
    console.log(`  project.yaml: ${action.hasProjectYaml ? options.overwriteManifest ? "已存在，将覆盖" : "已存在，保留" : "不存在，将创建"}`);
    console.log(`  project.sqlite: ${action.hasProjectDatabase ? "已存在，校验 schema" : "不存在，将初始化"}`);

    if (!options.apply) {
        return;
    }

    if (!action.hasProjectYaml || options.overwriteManifest) {
        await fs.writeFile(action.projectYamlPath, yaml.stringify({
            kind: "novel",
            title: action.title,
            summary: action.summary,
        }), "utf-8");
    }

    await initProjectDatabaseAtRoot(action.projectRoot);
}

async function readYamlFile<T>(filePath: string): Promise<T | null> {
    try {
        return yaml.parse(await fs.readFile(filePath, "utf-8")) as T;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

function normalizeTitle(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
            return String(candidate);
        }
    }
    return "Untitled Project";
}

function parseCliOptions(args: string[]): CliOptions {
    const options: CliOptions = {
        workspaceRoot: "workspace",
        apply: false,
        overwriteManifest: false,
    };

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--workspace-root") {
            options.workspaceRoot = requireValue(args, index, arg);
            index += 1;
            continue;
        }
        if (arg === "--apply") {
            options.apply = true;
            continue;
        }
        if (arg === "--overwrite-manifest") {
            options.overwriteManifest = true;
            continue;
        }
        if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
        throw new Error(`未知参数：${arg}`);
    }

    return options;
}

function requireValue(args: string[], index: number, name: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
        throw new Error(`${name} 需要一个值`);
    }
    return value;
}

function printHelp(): void {
    console.log(`Usage:
  bun scripts/db/migrate-project-workspaces.ts [--workspace-root <dir>] [--apply] [--overwrite-manifest]

Options:
  --workspace-root <dir>   Workspace Root，默认 workspace
  --apply                  实际写入 project.yaml 并初始化 .nbook/project.sqlite；不传则只预演
  --overwrite-manifest     project.yaml 已存在时也按当前目录 / workspace.yaml 重新生成

说明：
  本脚本只规范化现有 Project Workspace 目录，不会覆盖已有 project.yaml（除非指定 --overwrite-manifest）。
  Project SQLite 的建表与升级统一复用运行时初始化入口。
`);
}

async function assertDirectory(filePath: string, message: string): Promise<void> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isDirectory()) {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw new Error(`${message}：${displayPath(filePath)}`);
        }
        throw error;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function displayPath(filePath: string): string {
    return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

await main();
