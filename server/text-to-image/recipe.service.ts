import {createHash, randomInt} from "node:crypto";
import {z} from "zod";
import {
    createDefaultTextToImageRecipeSource,
    TextToImageRecipeSourceSchema,
    type TextToImageRecipeSnapshot,
    type TextToImageRecipeSource,
    type TextToImageRecipeStyle,
} from "nbook/shared/text-to-image-recipe";
import {
    createTextToImageRecipeSnapshot,
    DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
    parseTextToImageRecipeMarkdown,
    renderTextToImageRecipeMarkdown,
} from "nbook/server/text-to-image/recipe.codec";
import {
    assertTextToImageReferenceMutationScope,
    withTextToImageReferenceMutationLock,
} from "nbook/server/text-to-image/reference-asset-lock";
import {absoluteFsPath, invalidateProjectTreeIndex, resolveWorkspaceRootInput, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {
    USER_LOCAL_ACTOR,
    writeResolvedProjectTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";

export type TextToImageRecipeDocument = {
    exists: boolean;
    source: TextToImageRecipeSource;
    snapshot: TextToImageRecipeSnapshot;
};

export type TextToImageRecipeSaveInput = {
    projectPath: string;
    source: TextToImageRecipeSource;
    /** null 表示调用方确认文件尚不存在；非空值用于乐观并发。 */
    expectedRecipeSourceHash: string | null;
    /** 仅用于显式覆盖无法解析的现存 Recipe；必须等于服务端错误返回的原文件 hash。 */
    expectedInvalidSourceHash?: string;
};

export type TextToImageManualRecipeCompileInput = {
    projectPath: string;
    prompt: string;
    negativePrompt: string;
    count: number;
    expectedRecipeSourceHash: string;
};

export type TextToImageManualCompiledRequest = {
    prompt: string;
    negativePrompt: string;
    novelAi: {
        model: string;
        sampler: string;
        noiseSchedule: string;
        promptGuidance: number;
        promptGuidanceRescale: number;
        width: number;
        height: number;
        steps: number;
        seed: number;
        count: number;
        aiDefaultCharacterPosition: boolean;
        variety: boolean;
        smeaMode: "auto" | "off" | "on";
        smeaDyn: boolean;
        decrisper: boolean;
    };
    style: TextToImageRecipeStyle;
    recipeSnapshot: TextToImageRecipeSnapshot;
};

/** Recipe 文件存储 seam：生产实现统一走 Project 生命周期、文件历史与索引失效。 */
export interface TextToImageRecipeFileStore {
    resolveProjectRoot(projectPath: string): Promise<string>;
    assertProjectOpen(projectPath: string): void;
    read(root: string, filePath: string): Promise<string | null>;
    write(input: {root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}): Promise<void>;
    invalidate(root: string, projectPath: string): void;
}

/** 保存前发现 Project Recipe 已被其他入口修改。 */
export class TextToImageRecipeConflictError extends Error {
    readonly code = "TEXT_TO_IMAGE_RECIPE_CONFLICT";

    constructor() {
        super("Recipe 已被其他入口修改，请重新加载后再保存。");
        this.name = "TextToImageRecipeConflictError";
    }
}

/** Recipe Markdown 或模型能力不满足严格执行合同。 */
export class TextToImageRecipeInvalidError extends Error {
    readonly code = "TEXT_TO_IMAGE_RECIPE_INVALID";

    constructor(
        message: string,
        /** 仅当错误来自已存在的无效文件时非空，可用于显式修复写入。 */
        readonly fileContentHash: string | null = null,
    ) {
        super(message);
        this.name = "TextToImageRecipeInvalidError";
    }
}

/** Job 创建需要一个已显式保存的 Project Recipe，默认草稿不能静默成为执行真相。 */
export class TextToImageRecipeNotConfiguredError extends Error {
    readonly code = "TEXT_TO_IMAGE_RECIPE_NOT_CONFIGURED";

    constructor() {
        super("当前 Project 尚未保存文生图 Recipe，请先在文生图分页保存配置。");
        this.name = "TextToImageRecipeNotConfiguredError";
    }
}

/** 手工生成链路不支持参考资产（Vibe/Character Reference/Inpaint）；这些只走插图执行入口。 */
export class TextToImageManualReferencesUnsupportedError extends Error {
    readonly code = "TEXT_TO_IMAGE_MANUAL_REFERENCES_UNSUPPORTED";

    constructor() {
        super("手工生成不支持参考资产，请在插图执行流程中使用 Recipe 参考资源。");
        this.name = "TextToImageManualReferencesUnsupportedError";
    }
}

/** Recipe snapshot 是否包含任何参考选择（Vibe/Character/Inpaint）。 */
export function hasRecipeReferenceSelections(references: TextToImageRecipeSnapshot["references"]): boolean {
    return references.vibeReferences.length > 0
        || references.characterReferences.length > 0
        || references.inpaint !== null;
}

/** 默认 Project Recipe 的唯一服务端读写入口。 */
export class TextToImageRecipeService {
    constructor(private readonly files: TextToImageRecipeFileStore = new WorkspaceRecipeFileStore()) {}

    /** 读取 Recipe；缺失时返回未持久化默认草稿，绝不在 GET 中隐式写盘。 */
    async read(projectPathInput: string): Promise<TextToImageRecipeDocument> {
        const projectPath = z.string().trim().min(1).parse(projectPathInput);
        this.files.assertProjectOpen(projectPath);
        const root = await this.files.resolveProjectRoot(projectPath);
        return await withRecipeFileLock(root, async () => {
            const markdown = await this.files.read(root, DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH);
            if (markdown === null) {
                const source = createDefaultTextToImageRecipeSource();
                return {exists: false, source, snapshot: createTextToImageRecipeSnapshot(source)};
            }
            const source = parseExistingRecipe(markdown);
            return {exists: true, source, snapshot: createTextToImageRecipeSnapshot(source)};
        });
    }

    /** 以 expected hash 做乐观并发检查，并通过 tracked writer 规范写回 Recipe。 */
    async save(input: TextToImageRecipeSaveInput): Promise<TextToImageRecipeDocument> {
        const projectPath = z.string().trim().min(1).parse(input.projectPath);
        const source = TextToImageRecipeSourceSchema.parse(input.source);
        assertRecipeCapabilities(source);
        this.files.assertProjectOpen(projectPath);
        const root = await this.files.resolveProjectRoot(projectPath);
        // 与 Manifest registration / reference deletion 共享同一 Project mutation 锁，
        // 杜绝 Recipe 参考资源在保存与注册之间被竞态删除。
        return await withTextToImageReferenceMutationLock(projectPath, async (scope) => {
            assertTextToImageReferenceMutationScope(scope, {projectPath, projectRoot: root});
            return await withRecipeFileLock(root, async () => {
            const existingMarkdown = await this.files.read(root, DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH);
            let currentHash: string | null = null;
            if (existingMarkdown !== null) {
                try {
                    currentHash = createTextToImageRecipeSnapshot(parseExistingRecipe(existingMarkdown)).recipeSourceHash;
                } catch (error) {
                    if (!(error instanceof TextToImageRecipeInvalidError)
                        || !input.expectedInvalidSourceHash
                        || input.expectedInvalidSourceHash !== error.fileContentHash
                        || input.expectedRecipeSourceHash !== null) {
                        throw error;
                    }
                }
            }
            if (input.expectedInvalidSourceHash) {
                if (existingMarkdown === null || currentHash !== null) {
                    throw new TextToImageRecipeConflictError();
                }
            } else if (currentHash !== input.expectedRecipeSourceHash) {
                throw new TextToImageRecipeConflictError();
            }
            const markdown = renderTextToImageRecipeMarkdown(source);
            await this.files.write({
                root,
                projectPath,
                filePath: DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH,
                content: markdown,
                knownBefore: existingMarkdown,
            });
            this.files.invalidate(root, projectPath);
            return {exists: true, source, snapshot: createTextToImageRecipeSnapshot(source)};
            });
        });
    }

    /**
     * 首次使用时把默认 Recipe 落盘（"首开自动落盘"）。
     * 已存在时原样返回；现存文件无效时保持 fail-closed（由 read 抛 Invalid，不做覆盖）；
     * 并发首创只允许一个赢家，输家读回已落盘文档。
     */
    async ensurePersistedDefault(projectPathInput: string): Promise<TextToImageRecipeDocument> {
        const existing = await this.read(projectPathInput);
        if (existing.exists) return existing;
        try {
            return await this.save({projectPath: projectPathInput, source: existing.source, expectedRecipeSourceHash: null});
        } catch (error) {
            if (error instanceof TextToImageRecipeConflictError) return await this.read(projectPathInput);
            throw error;
        }
    }

    /**
     * 从已保存 Recipe 编译手工 Job；浏览器只能提供用户意图、数量和预期 hash。
     * `dimensions.fixed` 是手工生成的明确画幅；Storyboard 的 `byIntent` 选择由后续 Director 入口负责。
     */
    async compileManual(input: TextToImageManualRecipeCompileInput): Promise<TextToImageManualCompiledRequest> {
        const parsed = z.object({
            projectPath: z.string().trim().min(1),
            prompt: z.string().trim().min(1),
            negativePrompt: z.string(),
            count: z.number().int().min(1).max(4),
            expectedRecipeSourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
        }).strict().parse(input);
        const document = await this.read(parsed.projectPath);
        if (!document.exists) {
            throw new TextToImageRecipeNotConfiguredError();
        }
        if (document.snapshot.recipeSourceHash !== parsed.expectedRecipeSourceHash) {
            throw new TextToImageRecipeConflictError();
        }
        // 手工队列不投影参考资源：Recipe 含任何参考选择时拒绝，防止静默丢弃。
        if (hasRecipeReferenceSelections(document.snapshot.references)) {
            throw new TextToImageManualReferencesUnsupportedError();
        }
        const source = document.source;
        assertRecipeCapabilities(source);
        const activeStyle = source.styles.find((item) => item.id === source.activeStyleId) ?? source.styles[0];
        if (!activeStyle) {
            throw new TextToImageRecipeInvalidError("Recipe 缺少画风串预设", null);
        }
        return {
            prompt: parsed.prompt,
            negativePrompt: parsed.negativePrompt,
            novelAi: {
                model: source.model,
                sampler: source.sampler,
                noiseSchedule: source.noiseSchedule,
                promptGuidance: source.promptGuidance,
                promptGuidanceRescale: source.promptGuidanceRescale,
                width: source.dimensions.fixed.width,
                height: source.dimensions.fixed.height,
                steps: source.steps,
                seed: source.seed.policy === "fixed" ? source.seed.fixed : randomInt(0, 4_294_967_296),
                count: parsed.count,
                aiDefaultCharacterPosition: source.advanced.aiDefaultCharacterPosition,
                variety: source.advanced.variety,
                smeaMode: source.advanced.smeaMode,
                smeaDyn: source.advanced.smeaDyn,
                decrisper: source.advanced.decrisper,
            },
            style: {
                positivePrefix: activeStyle.positivePrefix,
                positiveSuffix: activeStyle.positiveSuffix,
                negativePrefix: activeStyle.negativePrefix,
                negativeSuffix: activeStyle.negativeSuffix,
                useFurryDataset: activeStyle.useFurryDataset,
                positiveQualityPreset: activeStyle.positiveQualityPreset,
                negativeQualityPreset: activeStyle.negativeQualityPreset,
            },
            recipeSnapshot: document.snapshot,
        };
    }
}

class WorkspaceRecipeFileStore implements TextToImageRecipeFileStore {
    async resolveProjectRoot(projectPath: string): Promise<string> {
        return z.string().min(1).parse(await resolveWorkspaceRootInput({projectPath}));
    }

    assertProjectOpen(projectPath: string): void {
        assertProjectOpen(textToImageProjectRef(projectPath));
    }

    async read(root: string, filePath: string): Promise<string | null> {
        try {
            return await readWorkspaceTextFile(absoluteFsPath(root), filePath);
        } catch (error) {
            if (isFileNotFound(error)) {
                return null;
            }
            throw error;
        }
    }

    async write(input: {root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}): Promise<void> {
        await writeResolvedProjectTextFileTracked({
            projectPath: input.projectPath,
            projectRoot: input.root,
            filePath: input.filePath,
            content: input.content,
            actor: USER_LOCAL_ACTOR,
            knownBefore: input.knownBefore,
        });
    }

    invalidate(root: string, projectPath: string): void {
        invalidateProjectTreeIndex(projectPath);
    }
}

function isFileNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** 严格解析现存 Recipe，并把 YAML/Zod/内容节点错误统一收敛为可恢复的稳定错误。 */
function parseExistingRecipe(markdown: string): TextToImageRecipeSource {
    try {
        const source = parseTextToImageRecipeMarkdown(markdown);
        assertRecipeCapabilities(source);
        return source;
    } catch {
        throw new TextToImageRecipeInvalidError(
            "Recipe Markdown 无法通过严格校验，请修正文件或使用返回的文件 hash 显式覆盖。",
            createHash("sha256").update(markdown, "utf8").digest("hex"),
        );
    }
}

/** NovelAI V4 只支持 autoSmea 开关，不接受 V3 的 sm/sm_dyn 手动字段。 */
function assertRecipeCapabilities(source: TextToImageRecipeSource): void {
    if (/^nai-diffusion-4(?:-|$)/u.test(source.model)
        && (source.advanced.smeaMode === "on" || source.advanced.smeaDyn)) {
        throw new TextToImageRecipeInvalidError("NovelAI V4 Recipe 只支持 SMEA 自动或关闭，不支持 SMEA Dyn。", null);
    }
}

const recipeFileMutationTails = new Map<string, Promise<void>>();

/** 把同一 Project Recipe 的重读、hash 检查和 tracked write 放进同一临界区。 */
async function withRecipeFileLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const key = `${root}\u0000${DEFAULT_TEXT_TO_IMAGE_RECIPE_PATH}`;
    const previous = recipeFileMutationTails.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.then(() => current);
    recipeFileMutationTails.set(key, tail);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (recipeFileMutationTails.get(key) === tail) {
            recipeFileMutationTails.delete(key);
        }
    }
}
