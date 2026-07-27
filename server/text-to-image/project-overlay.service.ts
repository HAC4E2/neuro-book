import {
    createGlobalProfileHomeFacade,
} from "nbook/server/agent/profiles/profile-home";
import {
    readIllustrationDirectorSelectorSnapshot,
    type IllustrationDirectorSelectorSnapshot,
} from "nbook/server/config/config-service";
import {
    parseStoryboardOverlayMarkdown,
    renderStoryboardOverlayMarkdown,
} from "nbook/server/text-to-image/storyboard-overlay.codec";
import {parseStoryboardPresetMarkdown} from "nbook/server/text-to-image/storyboard-preset.codec";
import {
    resolveStoryboardRules,
    type StoryboardRuleProvenance,
} from "nbook/server/text-to-image/storyboard-rule-resolver";
import {
    parseTagPatternOverlayMarkdown,
    renderTagPatternOverlayMarkdown,
} from "nbook/server/text-to-image/tag-pattern-overlay.codec";
import {parseTagPatternMarkdown} from "nbook/server/text-to-image/tag-pattern.codec";
import {
    assertStoryboardPatternPair,
    resolveTagPatterns,
    type TagPatternProvenance,
} from "nbook/server/text-to-image/tag-pattern-resolver";
import {
    ProjectOverlayEditorSnapshotSchema,
    ProjectOverlayPresetIdSchema,
    ProjectOverlaySaveRequestSchema,
    type ProjectOverlayBasePair,
    type ProjectOverlayEditorSnapshot,
    type ProjectOverlaySaveRequest,
} from "nbook/shared/text-to-image-project-overlays";
import {
    createStoryboardOverlaySemanticHash,
    StoryboardOverlaySchema,
    type StoryboardOverlay,
    type StoryboardPreset,
    type StoryboardRule,
} from "nbook/shared/text-to-image-storyboard-preset";
import {
    createTagPatternOverlayHashes,
    TagPatternOverlaySchema,
    type TagPatternOverlay,
    type TagPattern,
    type TagPatternSet,
} from "nbook/shared/text-to-image-tag-pattern";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {ensureDefaultStoryboardPreset} from "nbook/server/text-to-image/storyboard-preset-init";
import {absoluteFsPath, invalidateProjectTreeIndex, resolveGlobalProfileNbookRoot, resolveWorkspaceRootInput} from "nbook/server/text-to-image/compat";
import {
    readWorkspaceTextFile,
} from "nbook/server/workspace-files/workspace-files";
import {
    USER_LOCAL_ACTOR,
    writeResolvedProjectTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";

const PROFILE_KEY = "illustration.director";
const overlayLocks = new Map<string, Promise<void>>();

export type ProjectOverlayErrorCode =
    | "PROJECT_OVERLAY_INVALID"
    | "PROJECT_OVERLAY_FILE_CONFLICT"
    | "STORYBOARD_PRESET_STALE"
    | "STORYBOARD_OVERLAY_CONFLICT"
    | "TAG_PATTERN_SET_STALE"
    | "TAG_PATTERN_OVERLAY_CONFLICT";

/** Project overlay 的稳定领域错误。 */
export class ProjectOverlayError extends Error {
    readonly code: ProjectOverlayErrorCode;

    constructor(code: ProjectOverlayErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "ProjectOverlayError";
        this.code = code;
    }
}

/** expected file hash 不匹配时的专用 CAS 错误。 */
export class ProjectOverlayConflictError extends ProjectOverlayError {
    constructor() {
        super("PROJECT_OVERLAY_FILE_CONFLICT", "Project overlay 文件已变化，请刷新后重试");
        this.name = "ProjectOverlayConflictError";
    }
}

export type ProjectOverlaySelectorStore = {
    read(): Promise<IllustrationDirectorSelectorSnapshot>;
};

export type ProjectOverlayFileStore = {
    resolveProjectRoot(projectPath: string): Promise<string>;
    assertProjectOpen(projectPath: string, root: string): void;
    readGlobal(filePath: string): Promise<string | null>;
    readProject(root: string, filePath: string): Promise<string | null>;
    writeProject(input: {root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}): Promise<void>;
    invalidate(projectPath: string): void;
};

type ProjectOverlayServiceOptions = {
    workspaceRoot?: string;
    selector?: ProjectOverlaySelectorStore;
    store?: ProjectOverlayFileStore;
};

type ActiveCompanion = {
    preset: StoryboardPreset;
    patterns: TagPatternSet;
    base: ProjectOverlayBasePair;
};

/** Planning Input Builder 消费的唯一 Effective Preset / Pattern 真相快照。 */
export type ProjectIllustrationPlanningSnapshot = {
    preset: {
        presetId: string;
        semanticHash: string;
        rules: StoryboardRule[];
        provenance: StoryboardRuleProvenance[];
    };
    patterns: {
        patternSetId: string;
        planningHash: string;
        renderHash: string;
        patterns: TagPattern[];
        provenance: TagPatternProvenance[];
    };
};

/** 读取、CAS 保存并确定性应用 Project-local Storyboard/Pattern overlay。 */
export class ProjectOverlayService {
    private readonly selector: ProjectOverlaySelectorStore;
    private readonly store: ProjectOverlayFileStore;

    constructor(options: ProjectOverlayServiceOptions = {}) {
        this.selector = options.selector ?? {read: readIllustrationDirectorSelectorSnapshot};
        this.store = options.store ?? new WorkspaceProjectOverlayFileStore(options.workspaceRoot);
    }

    /** 读取 active base 与两份 Project overlay 编辑/有效结果快照。 */
    async read(input: {projectPath: string}): Promise<ProjectOverlayEditorSnapshot> {
        const projectPath = input.projectPath.trim();
        const root = await this.store.resolveProjectRoot(projectPath);
        this.store.assertProjectOpen(projectPath, root);
        return this.readSnapshot(projectPath, root);
    }

    /** 解析 active global companion 与 approved Project overlays，返回确定性 planning 快照。 */
    async readEffective(input: {projectPath: string}): Promise<ProjectIllustrationPlanningSnapshot> {
        const projectPath = input.projectPath.trim();
        const root = await this.store.resolveProjectRoot(projectPath);
        this.store.assertProjectOpen(projectPath, root);
        const active = await this.readActiveCompanion();
        const presetId = ProjectOverlayPresetIdSchema.parse(active.preset.presetId);
        const [storyboardText, patternsText] = await Promise.all([
            this.store.readProject(root, storyboardOverlayPath(presetId)),
            this.store.readProject(root, patternOverlayPath(presetId)),
        ]);
        const storyboard = storyboardText === null
            ? parseStoryboardOverlay(renderStoryboardOverlayMarkdown(createStoryboardDraft(active)))
            : parseStoryboardOverlay(storyboardText);
        const patterns = patternsText === null
            ? parsePatternOverlay(renderTagPatternOverlayMarkdown(createPatternDraft(active)))
            : parsePatternOverlay(patternsText);
        const storyboardEffective = resolveStoryboardRules({base: active.preset, overlay: storyboard.overlay});
        const patternEffective = resolveTagPatterns({base: active.patterns, overlay: patterns.overlay});
        return {
            preset: {
                presetId,
                semanticHash: storyboardEffective.effectivePresetHash,
                rules: storyboardEffective.effectiveRules,
                provenance: storyboardEffective.provenance,
            },
            patterns: {
                patternSetId: active.patterns.patternSetId,
                planningHash: patternEffective.effectivePlanningHash,
                renderHash: patternEffective.effectiveRenderHash,
                patterns: patternEffective.effectivePatterns,
                provenance: patternEffective.provenance,
            },
        };
    }

    /** 以 expected file hash 保存草稿或保存并应用；批准 hash 只由服务端计算。 */
    async save(input: ProjectOverlaySaveRequest): Promise<ProjectOverlayEditorSnapshot> {
        const request = ProjectOverlaySaveRequestSchema.parse(input);
        const root = await this.store.resolveProjectRoot(request.projectPath);
        this.store.assertProjectOpen(request.projectPath, root);
        return withOverlayLock(`${root}:${request.presetId}:${request.kind}`, async () => {
            const active = await this.readActiveCompanion();
            if (active.preset.presetId !== request.presetId) {
                throw new ProjectOverlayError("STORYBOARD_PRESET_STALE", "请求 presetId 不是当前 active companion");
            }
            const filePath = request.kind === "storyboard"
                ? storyboardOverlayPath(request.presetId)
                : patternOverlayPath(request.presetId);
            const before = await this.store.readProject(root, filePath);
            const currentFileHash = before === null ? null : request.kind === "storyboard"
                ? parseStoryboardOverlay(before).fileHash
                : parsePatternOverlay(before).fileHash;
            if (currentFileHash !== request.expectedFileHash) throw new ProjectOverlayConflictError();

            const content = request.kind === "storyboard"
                ? prepareStoryboardWrite(request, active)
                : preparePatternWrite(request, active);
            await this.store.writeProject({root, projectPath: request.projectPath, filePath, content, knownBefore: before});
            this.store.invalidate(request.projectPath);
            return this.readSnapshot(request.projectPath, root);
        });
    }

    private async readSnapshot(projectPath: string, root: string): Promise<ProjectOverlayEditorSnapshot> {
        const active = await this.readActiveCompanion();
        const presetId = ProjectOverlayPresetIdSchema.parse(active.preset.presetId);
        const storyboardPath = storyboardOverlayPath(presetId);
        const patternsPath = patternOverlayPath(presetId);
        const [storyboardText, patternsText] = await Promise.all([
            this.store.readProject(root, storyboardPath),
            this.store.readProject(root, patternsPath),
        ]);
        const storyboard = storyboardText === null
            ? parseStoryboardOverlay(renderStoryboardOverlayMarkdown(createStoryboardDraft(active)))
            : parseStoryboardOverlay(storyboardText);
        const patterns = patternsText === null
            ? parsePatternOverlay(renderTagPatternOverlayMarkdown(createPatternDraft(active)))
            : parsePatternOverlay(patternsText);
        const storyboardEffective = resolveStoryboardRules({base: active.preset, overlay: storyboard.overlay});
        const patternEffective = resolveTagPatterns({base: active.patterns, overlay: patterns.overlay});
        return ProjectOverlayEditorSnapshotSchema.parse({
            schemaVersion: "nbook.project-overlay-editor/v1",
            projectPath,
            base: active.base,
            storyboard: {
                kind: "storyboard",
                path: storyboardPath,
                exists: storyboardText !== null,
                markdown: storyboardText ?? renderStoryboardOverlayMarkdown(storyboard.overlay, storyboard.body),
                fileHash: storyboardText === null ? null : storyboard.fileHash,
                semanticHash: storyboard.semanticHash,
                reviewState: storyboard.reviewState,
                operationCount: storyboard.overlay.operations.length,
                effectiveStatus: storyboardEffective.status,
                effectivePresetHash: storyboardEffective.effectivePresetHash,
                diagnostics: storyboardEffective.diagnostics,
            },
            patterns: {
                kind: "patterns",
                path: patternsPath,
                exists: patternsText !== null,
                markdown: patternsText ?? renderTagPatternOverlayMarkdown(patterns.overlay, patterns.body),
                fileHash: patternsText === null ? null : patterns.fileHash,
                planningHash: patterns.hashes.planningHash,
                renderHash: patterns.hashes.renderHash,
                reviewState: patterns.reviewState,
                operationCount: patterns.overlay.operations.length,
                effectiveStatus: patternEffective.status,
                effectivePlanningHash: patternEffective.effectivePlanningHash,
                effectiveRenderHash: patternEffective.effectiveRenderHash,
                diagnostics: patternEffective.diagnostics,
            },
        });
    }

    private async readActiveCompanion(): Promise<ActiveCompanion> {
        // 确保默认预设存在后再读取
        await ensureDefaultStoryboardPreset();
        const selector = await this.selector.read();
        const presetPath = selector.storyboardPresetKey;
        const patternPath = presetPath.replace(/^storyboard-presets\//u, "tag-patterns/");
        const [presetText, patternText] = await Promise.all([
            this.store.readGlobal(presetPath),
            this.store.readGlobal(patternPath),
        ]);
        if (presetText === null) throw new ProjectOverlayError("STORYBOARD_PRESET_STALE", "active Storyboard Preset 缺失");
        if (patternText === null) throw new ProjectOverlayError("TAG_PATTERN_SET_STALE", "active Tag Pattern companion 缺失");
        try {
            const preset = parseStoryboardPresetMarkdown(presetText);
            const patterns = parseTagPatternMarkdown(patternText);
            assertStoryboardPatternPair({preset: preset.preset, patternSet: patterns.patternSet});
            return {
                preset: preset.preset,
                patterns: patterns.patternSet,
                base: {
                    presetId: preset.preset.presetId,
                    patternSetId: patterns.patternSet.patternSetId,
                    packageId: preset.preset.packageId,
                    resourceKey: preset.preset.resourceKey,
                    presetPath,
                    patternPath,
                    storyboardSemanticHash: preset.hashes.semanticHash,
                    patternPlanningHash: patterns.hashes.planningHash,
                    patternRenderHash: patterns.hashes.renderHash,
                    presetFileHash: preset.fileHash,
                    patternFileHash: patterns.fileHash,
                },
            };
        } catch (error) {
            if (error instanceof ProjectOverlayError) throw error;
            const rawMessage = error instanceof Error ? error.message : String(error);
            const code = rawMessage.includes("TAG_PATTERN") ? "TAG_PATTERN_SET_STALE" : "STORYBOARD_PRESET_STALE";
            const message = rawMessage.startsWith(`${code}: `)
                ? rawMessage.slice(code.length + 2)
                : rawMessage;
            throw new ProjectOverlayError(code, message);
        }
    }
}

class WorkspaceProjectOverlayFileStore implements ProjectOverlayFileStore {
    private readonly globalHome;

    constructor(workspaceRoot?: string) {
        this.globalHome = createGlobalProfileHomeFacade(resolveGlobalProfileNbookRoot(workspaceRoot), PROFILE_KEY);
    }

    async resolveProjectRoot(projectPath: string): Promise<string> {
        const root = await resolveWorkspaceRootInput({projectPath});
        if (!root) throw new ProjectOverlayError("PROJECT_OVERLAY_INVALID", "Project Workspace root 缺失");
        return root;
    }

    assertProjectOpen(projectPath: string, _root: string): void {
        assertProjectOpen(projectPath);
    }

    async readGlobal(filePath: string): Promise<string | null> {
        try {
            return await this.globalHome.readText(filePath);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    async readProject(root: string, filePath: string): Promise<string | null> {
        try {
            return await readWorkspaceTextFile(absoluteFsPath(root), filePath);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    async writeProject(input: {root: string; projectPath: string; filePath: string; content: string; knownBefore: string | null}): Promise<void> {
        await writeResolvedProjectTextFileTracked({
            projectPath: input.projectPath,
            projectRoot: input.root,
            filePath: input.filePath,
            content: input.content,
            actor: USER_LOCAL_ACTOR,
            knownBefore: input.knownBefore,
        });
    }

    invalidate(projectPath: string): void {
        invalidateProjectTreeIndex(projectPath);
    }
}

function createStoryboardDraft(active: ActiveCompanion): StoryboardOverlay {
    return StoryboardOverlaySchema.parse({
        schema: "nbook.storyboard-overlay/v1",
        overlayId: "project.storyboard",
        presetId: active.preset.presetId,
        enabled: true,
        baseSemanticHash: active.base.storyboardSemanticHash,
        review: {status: "pending"},
        macroBindings: {},
        operations: [],
    });
}

function createPatternDraft(active: ActiveCompanion): TagPatternOverlay {
    return TagPatternOverlaySchema.parse({
        schema: "nbook.tag-pattern-overlay/v1",
        overlayId: "project.patterns",
        patternSetId: active.patterns.patternSetId,
        enabled: true,
        basePlanningHash: active.base.patternPlanningHash,
        baseRenderHash: active.base.patternRenderHash,
        review: {status: "pending"},
        operations: [],
    });
}

function prepareStoryboardWrite(request: ProjectOverlaySaveRequest, active: ActiveCompanion): string {
    const parsed = parseStoryboardOverlay(request.markdown);
    if (parsed.overlay.presetId !== active.preset.presetId
        || parsed.overlay.baseSemanticHash !== active.base.storyboardSemanticHash) {
        throw new ProjectOverlayError("STORYBOARD_PRESET_STALE", "Storyboard overlay 未绑定当前 active base hash");
    }
    const pending = StoryboardOverlaySchema.parse({...parsed.overlay, review: {status: "pending"}});
    if (request.mode === "draft") return renderStoryboardOverlayMarkdown(pending, parsed.body);
    const approved = StoryboardOverlaySchema.parse({
        ...pending,
        review: {status: "approved", approvedSemanticHash: createStoryboardOverlaySemanticHash(pending)},
    });
    const effective = resolveStoryboardRules({base: active.preset, overlay: approved, strictOverlay: true});
    if (effective.status !== "applied") {
        const diagnostic = effective.diagnostics[0];
        throw new ProjectOverlayError(diagnostic?.code ?? "STORYBOARD_OVERLAY_CONFLICT", diagnostic?.message ?? "Storyboard overlay 冲突");
    }
    return renderStoryboardOverlayMarkdown(approved, parsed.body);
}

function preparePatternWrite(request: ProjectOverlaySaveRequest, active: ActiveCompanion): string {
    const parsed = parsePatternOverlay(request.markdown);
    if (parsed.overlay.patternSetId !== active.patterns.patternSetId
        || parsed.overlay.basePlanningHash !== active.base.patternPlanningHash
        || parsed.overlay.baseRenderHash !== active.base.patternRenderHash) {
        throw new ProjectOverlayError("TAG_PATTERN_SET_STALE", "Pattern overlay 未绑定当前 active base hashes");
    }
    const pending = TagPatternOverlaySchema.parse({...parsed.overlay, review: {status: "pending"}});
    if (request.mode === "draft") return renderTagPatternOverlayMarkdown(pending, parsed.body);
    const hashes = createTagPatternOverlayHashes(pending);
    const approved = TagPatternOverlaySchema.parse({
        ...pending,
        review: {
            status: "approved",
            approvedPlanningHash: hashes.planningHash,
            approvedRenderHash: hashes.renderHash,
        },
    });
    const effective = resolveTagPatterns({base: active.patterns, overlay: approved, strictOverlay: true});
    if (effective.status !== "applied") {
        const diagnostic = effective.diagnostics[0];
        throw new ProjectOverlayError(diagnostic?.code ?? "TAG_PATTERN_OVERLAY_CONFLICT", diagnostic?.message ?? "Pattern overlay 冲突");
    }
    return renderTagPatternOverlayMarkdown(approved, parsed.body);
}

function parseStoryboardOverlay(markdown: string) {
    try {
        return parseStoryboardOverlayMarkdown(markdown);
    } catch (error) {
        throw new ProjectOverlayError("PROJECT_OVERLAY_INVALID", error instanceof Error ? error.message : String(error));
    }
}

function parsePatternOverlay(markdown: string) {
    try {
        return parseTagPatternOverlayMarkdown(markdown);
    } catch (error) {
        throw new ProjectOverlayError("PROJECT_OVERLAY_INVALID", error instanceof Error ? error.message : String(error));
    }
}

function storyboardOverlayPath(presetId: string): string {
    return `agents/illustration.director/storyboard-overrides/${ProjectOverlayPresetIdSchema.parse(presetId)}.md`;
}

function patternOverlayPath(presetId: string): string {
    return `agents/illustration.director/tag-pattern-overrides/${ProjectOverlayPresetIdSchema.parse(presetId)}.md`;
}

/** 同一 Project/preset/kind 的 CAS read-modify-write 必须串行。 */
async function withOverlayLock<TResult>(key: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = overlayLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => current);
    overlayLocks.set(key, tail);
    await previous.catch(() => undefined);
    try {
        return await operation();
    } finally {
        release();
        if (overlayLocks.get(key) === tail) overlayLocks.delete(key);
    }
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
