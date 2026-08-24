import {createHash, randomUUID} from "node:crypto";
import {createWriteStream} from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {pipeline} from "node:stream/promises";
import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {ZipFile} from "yazl";

const BASELINE_COMMIT = "f7caf3eb4e231c1b9fe53dbc312215b105008600";
const PACKAGE_VERSION = "overlay-v1";

/**
 * 仅枚举文生图运行时需要覆盖到官方 master 的宿主文件。
 * 不允许从仓库根目录递归收集，避免把 .env、workspace、图片或本地数据库带入压缩包。
 */
const INTEGRATION_FILES = [
    "packages/neuro-book/app/components/common/form/BooleanToggleButton.vue",
    "packages/neuro-book/app/components/markdown-studio/MarkdownStudio.vue",
    "packages/neuro-book/app/components/markdown-studio/MarkdownStudioToolbar.vue",
    "packages/neuro-book/app/components/markdown-studio/MarkdownStudioWorkbench.vue",
    "packages/neuro-book/app/components/markdown-studio/TipTapMarkdownEditor.vue",
    "packages/neuro-book/app/components/markdown-studio/markdown-studio-tool-availability.ts",
    "packages/neuro-book/app/components/markdown-studio/tiptap/TextToImagePrompt.ts",
    "packages/neuro-book/app/components/markdown-studio/tiptap/WorkspaceMarkdownImage.ts",
    "packages/neuro-book/app/components/markdown-studio/tiptap/markdown-editor-extensions.ts",
    "packages/neuro-book/app/components/novel-ide/NovelIdeActivityBar.vue",
    "packages/neuro-book/app/i18n/locales/en-US.ts",
    "packages/neuro-book/app/i18n/locales/zh-CN.ts",
    "packages/neuro-book/app/pages/index.vue",
    "packages/neuro-book/app/stores/novel-ide.ts",
    "packages/neuro-book/app/utils/novelai-token-counter.ts",
    "packages/neuro-book/app/utils/text-to-image-context-import.ts",
    "packages/neuro-book/app/utils/workbench-chrome.ts",
    "packages/neuro-book/assets/workspace/.nbook/templates/project-directory-templates/lorebook/character/default/.group.json",
    "bun.lock",
    "packages/neuro-book/package.json",
    "packages/neuro-book/prisma/migrations/sqlite/20260803160000_text_to_image_provider/migration.sql",
    "packages/neuro-book/prisma/project.schema.prisma",
    "packages/neuro-book/prisma/schema.sqlite.prisma",
    "packages/neuro-book/scripts/db/migrate-project-workspaces.ts",
    "packages/neuro-book/server/config/config-service.ts",
    "packages/neuro-book/server/config/normalizer.ts",
    "packages/neuro-book/server/config/registry.ts",
    "packages/neuro-book/server/config/types.ts",
    "packages/neuro-book/server/workspace-files/project-workspace.ts",
    "packages/neuro-book/shared/dto/config.dto.ts",
    "packages/neuro-book/shared/dto/text-to-image.dto.ts",
    "packages/neuro-book/shared/text-to-image-markdown.ts",
    "packages/neuro-book/shared/text-to-image-novelai-prompt.ts",
    "packages/neuro-book/shared/text-to-image-prompt-replacement.ts",
] as const;

const FEATURE_DIRECTORIES = [
    "packages/neuro-book/app/components/novel-ide/text-to-image",
    "packages/neuro-book/server/api/text-to-image",
    "packages/neuro-book/server/generated/project-prisma",
    "packages/neuro-book/server/text-to-image",
] as const;

const SOURCE_EXTENSIONS = new Set([".json", ".lock", ".prisma", ".sql", ".ts", ".vue"]);
const FORBIDDEN_MEDIA_EXTENSIONS = new Set([
    ".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp",
    ".mp3", ".mp4", ".ogg", ".wav", ".webm",
]);
const FORBIDDEN_DATA_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const FORBIDDEN_SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{20,}\b/u,
    /\bnai_[A-Za-z0-9_-]{20,}\b/u,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}\b/u,
] as const;

type FileManifestEntry = {
    path: string;
    bytes: number;
    sha256: string;
};

async function main(): Promise<void> {
    const sourceRoot = path.resolve(readArgument("--source") ?? process.cwd());
    const outputDirectory = path.resolve(readArgument("--output") ?? path.join(sourceRoot, "artifacts"));
    const buildRoot = resolveAgentScratchPath("text-to-image-overlay", randomUUID());
    const stagingRoot = path.join(buildRoot, "staging");
    const generatedAt = new Date().toISOString();
    const archiveName = `neuro-book-text-to-image-${PACKAGE_VERSION}-master-${BASELINE_COMMIT.slice(0, 8)}.zip`;
    const archivePath = path.join(outputDirectory, archiveName);

    try {
        await fs.mkdir(stagingRoot, {recursive: true});
        await fs.mkdir(outputDirectory, {recursive: true});

    const relativePaths = await collectPackageFiles(sourceRoot);
    for (const relativePath of relativePaths) {
        await copyCheckedFile(sourceRoot, stagingRoot, relativePath);
    }

    const manifestEntries = await createManifestEntries(stagingRoot, relativePaths);
    const metadataDirectory = path.join(stagingRoot, ".nbook-overlay", "text-to-image");
    await fs.mkdir(metadataDirectory, {recursive: true});
    await fs.writeFile(
        path.join(metadataDirectory, "README.md"),
        createInstallReadme(generatedAt, manifestEntries.length),
        "utf8",
    );
    await fs.writeFile(
        path.join(metadataDirectory, "manifest.json"),
        `${JSON.stringify({
            package: "neuro-book-text-to-image",
            version: PACKAGE_VERSION,
            baseline: {
                repository: "https://github.com/HAC4E2/neuro-book",
                branch: "master",
                commit: BASELINE_COMMIT,
            },
            generatedAt,
            privacyBoundary: {
                credentials: false,
                userConfig: false,
                projects: false,
                novels: false,
                images: false,
                databases: false,
            },
            builtInState: {
                providers: 0,
                contextProfiles: 0,
                requestTypeBindings: 0,
                generationRecipes: 0,
                referenceImages: 0,
                wordReplacementProfiles: ["default"],
                characterGroups: ["default"],
            },
            files: manifestEntries,
        }, null, 2)}\n`,
        "utf8",
    );

    const archiveFiles = await walkFiles(stagingRoot);
    await createZip(stagingRoot, archivePath, archiveFiles);
    const archiveBuffer = await fs.readFile(archivePath);
    const archiveSha256 = createHash("sha256").update(archiveBuffer).digest("hex");

        process.stdout.write(`${JSON.stringify({
            archivePath,
            archiveSha256,
            archiveBytes: archiveBuffer.byteLength,
            sourceFileCount: manifestEntries.length,
        }, null, 2)}\n`);
    } finally {
        await fs.rm(buildRoot, {recursive: true, force: true});
    }
}

async function collectPackageFiles(sourceRoot: string): Promise<string[]> {
    const files = new Set<string>(INTEGRATION_FILES);
    for (const directory of FEATURE_DIRECTORIES) {
        const absoluteDirectory = path.join(sourceRoot, directory);
        for (const relativePath of await walkFiles(absoluteDirectory)) {
            if (isTestFile(relativePath)) continue;
            files.add(toPosixPath(path.join(directory, relativePath)));
        }
    }
    return [...files].sort((left, right) => left.localeCompare(right, "en"));
}

async function walkFiles(root: string): Promise<string[]> {
    const result: string[] = [];
    const visit = async (directory: string): Promise<void> => {
        const entries = await fs.readdir(directory, {withFileTypes: true});
        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) {
                throw new Error(`覆盖包不接受符号链接：${absolutePath}`);
            }
            if (entry.isDirectory()) {
                await visit(absolutePath);
            } else if (entry.isFile()) {
                result.push(toPosixPath(path.relative(root, absolutePath)));
            }
        }
    };
    await visit(root);
    return result.sort((left, right) => left.localeCompare(right, "en"));
}

async function copyCheckedFile(sourceRoot: string, stagingRoot: string, relativePath: string): Promise<void> {
    assertSafeRelativePath(relativePath);
    const sourcePath = path.resolve(sourceRoot, relativePath);
    const expectedPrefix = `${sourceRoot}${path.sep}`;
    if (!sourcePath.startsWith(expectedPrefix)) {
        throw new Error(`文件越过源码根目录：${relativePath}`);
    }
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile()) throw new Error(`白名单项不是普通文件：${relativePath}`);

    const content = await fs.readFile(sourcePath);
    const text = content.toString("utf8");
    if (text.includes(sourceRoot) || text.includes(sourceRoot.replaceAll("\\", "/"))) {
        throw new Error(`源码含本机绝对路径：${relativePath}`);
    }
    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
        if (pattern.test(text)) throw new Error(`源码疑似含真实凭据：${relativePath}`);
    }

    const destinationPath = path.join(stagingRoot, relativePath);
    await fs.mkdir(path.dirname(destinationPath), {recursive: true});
    await fs.copyFile(sourcePath, destinationPath);
}

function assertSafeRelativePath(relativePath: string): void {
    const normalized = toPosixPath(relativePath);
    if (normalized.startsWith("/") || normalized.includes("../")) {
        throw new Error(`非法白名单路径：${relativePath}`);
    }
    const lower = normalized.toLowerCase();
    const baseName = path.posix.basename(lower);
    const extension = path.posix.extname(lower);
    if (baseName === ".env" || baseName.startsWith(".env.")) {
        throw new Error(`覆盖包禁止环境配置：${relativePath}`);
    }
    if (FORBIDDEN_MEDIA_EXTENSIONS.has(extension)) {
        throw new Error(`覆盖包禁止媒体文件：${relativePath}`);
    }
    if (FORBIDDEN_DATA_EXTENSIONS.has(extension)) {
        throw new Error(`覆盖包禁止数据库：${relativePath}`);
    }
    if (!SOURCE_EXTENSIONS.has(extension) && baseName !== "bun.lock") {
        throw new Error(`覆盖包出现未登记源码类型：${relativePath}`);
    }
    if (
        lower.startsWith("workspace/")
        || lower.startsWith(".agent/")
        || lower.startsWith("datasets/")
    ) {
        throw new Error(`覆盖包出现运行时或私人数据路径：${relativePath}`);
    }
}

function isTestFile(relativePath: string): boolean {
    return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(toPosixPath(relativePath));
}

async function createManifestEntries(stagingRoot: string, relativePaths: string[]): Promise<FileManifestEntry[]> {
    return await Promise.all(relativePaths.map(async (relativePath) => {
        const content = await fs.readFile(path.join(stagingRoot, relativePath));
        return {
            path: toPosixPath(relativePath),
            bytes: content.byteLength,
            sha256: createHash("sha256").update(content).digest("hex"),
        };
    }));
}

async function createZip(stagingRoot: string, archivePath: string, relativePaths: string[]): Promise<void> {
    const zipFile = new ZipFile();
    for (const relativePath of relativePaths) {
        zipFile.addFile(path.join(stagingRoot, relativePath), toPosixPath(relativePath));
    }
    zipFile.end();
    await pipeline(zipFile.outputStream, createWriteStream(archivePath));
}

function createInstallReadme(generatedAt: string, sourceFileCount: number): string {
    return `# NeuroBook 文生图覆盖安装包

本包面向官方 \`master\` 提交 \`${BASELINE_COMMIT}\`，把文生图运行时源码覆盖到仓库根目录。包内共有 ${sourceFileCount} 个源码文件，生成时间为 ${generatedAt}。

## 安装

1. 确认目标仓库位于上述提交，且工作区没有需要保留的未提交修改。
2. 将压缩包内容直接解压到仓库根目录，允许覆盖同名文件。
3. 运行 \`bun install --frozen-lockfile\` 刷新依赖，再运行 \`bun run --cwd packages/neuro-book generate\` 生成本机 Prisma 客户端。
4. 使用 \`bun run --cwd packages/neuro-book dev\` 或原有宿主命令启动 NeuroBook。

若 Windows 上的 Bun 报告 \`failed to remap this bin\`，改用不经过 \`.bin\` 重映射的等价命令：

\`\`\`powershell
bun node_modules/prisma/build/index.js generate --config ./packages/neuro-book/prisma.config.ts --schema ./packages/neuro-book/prisma/schema.sqlite.prisma
bun node_modules/prisma/build/index.js generate --config ./packages/neuro-book/prisma.config.ts --schema ./packages/neuro-book/prisma/project.schema.prisma
\`\`\`

## 数据边界

压缩包不包含 API Key、Provider 记录、用户配置、Project、小说、图片、参考图、数据库或本机路径。干净状态只包含内置的 \`default\` 敏感词替换档案和 \`default\` 角色分组；Provider、上下文预设、请求绑定、画风串和参考图均为空。

这是按固定 master 提交制作的覆盖包，不保证可覆盖未来 master。覆盖已有改动前请先提交或备份；卸载可在无其它修改时通过 Git 恢复本清单中的文件并删除新增文件。
`;
}

function readArgument(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少值`);
    return value;
}

function toPosixPath(value: string): string {
    return value.replaceAll("\\", "/");
}

await main();
