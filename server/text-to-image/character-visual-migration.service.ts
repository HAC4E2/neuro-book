import fs from "node:fs/promises";
import path from "node:path";
import {z} from "zod";
import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    CHARACTER_IMAGE_TAG_FIELDS,
    type CharacterImageTagField,
} from "nbook/shared/text-to-image-character-visual";
import {
    CharacterVisualSourceInspectionSchema,
    CharacterVisualSourceMergePreviewSchema,
    CharacterVisualSourceRelativePathSchema,
    CharacterVisualDirectorPreviewSchema,
    CharacterVisualDirectorProposalRecordSchema,
    type CharacterVisualSourceInspection,
    type CharacterVisualSourceMergePreview,
    type CharacterVisualDirectorPreview,
    type CharacterVisualDirectorProposal,
    type CharacterVisualDirectorProposalRecord,
    type Chatu8CharacterVisualSourcePackage,
} from "nbook/shared/text-to-image-character-source";
import {
    CharacterVisualMigrationBlockedEntrySchema,
    CharacterVisualMigrationCandidateSchema,
    CharacterVisualMigrationResolutionEntrySchema,
    CharacterVisualMigrationReviewEntrySchema,
    CharacterVisualMigrationScanSchema,
    CharacterVisualMigrationSnapshotSchema,
    type CharacterVisualMigrationCandidate,
    type CharacterVisualMigrationScan,
    type CharacterVisualMigrationSnapshot,
} from "nbook/shared/text-to-image-character-migration";
import {
    type TagPolicyReviewApprovalInput,
    type TagResolverExplicitResult,
} from "nbook/shared/text-to-image-tag-resolver";
import {
    TextToImageContractHashSchema,
} from "nbook/shared/text-to-image-tag-resolution";
import {
    createLegacyCharacterVisualDraftGroup,
    inspectCharacterVisualDraftGroup,
    inspectLegacyCharacterVisualGroup,
    materializeCharacterVisualV2,
    type CharacterVisualDraftGroupInput,
} from "nbook/server/text-to-image/character-visual-migration";
import {parseChatu8CharacterVisualSource} from "nbook/server/text-to-image/chatu8-character-visual-source";
import {
    createCharacterImageTagsFileHash,
    createOutfitTagsFileHash,
    parseCharacterImageTagsMarkdown,
    parseOutfitTagsMarkdown,
    renderCharacterImageTagsMarkdown,
    renderOutfitTagsMarkdown,
} from "nbook/server/text-to-image/character-visual.codec";
import type {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import {resolveWorkspaceRootInput} from "nbook/server/text-to-image/compat";
import {invalidateProjectWorkspaceIndexAfterMutation} from "nbook/server/workspace-files/project-workspace-index";
import {
    parseMarkdownDocument,
    readWorkspaceTextFile,
    scanWorkspaceTree,
} from "nbook/server/workspace-files/workspace-files";
import {
    USER_LOCAL_ACTOR,
    writeWorkspaceTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";

const RESOLUTION_SCHEMA_VERSION = "nbook.character-visual-migration-resolution/v1" as const;
const APPLY_JOURNAL_SCHEMA_VERSION = "nbook.character-visual-migration-apply/v2" as const;
const MIGRATION_ROOT = ".nbook/text-to-image/character-visual-migrations";

const MigrationResolutionSchema = z.object({
    schemaVersion: z.literal(RESOLUTION_SCHEMA_VERSION),
    migrationId: z.string().regex(/^character-migration-[a-f0-9]{24}$/u),
    stage: z.enum(["pending_unresolved", "review_required", "blocked", "ready", "applying", "applied"]),
    resolutions: z.array(CharacterVisualMigrationResolutionEntrySchema).max(10000),
    reviews: z.array(CharacterVisualMigrationReviewEntrySchema).max(10000),
    blocked: z.array(CharacterVisualMigrationBlockedEntrySchema).max(10000),
    updatedAt: z.string().datetime(),
}).strict();
type MigrationResolution = z.infer<typeof MigrationResolutionSchema>;

const JournalWriteSchema = z.object({
    path: z.string().trim().min(1).max(500),
    sourceHash: TextToImageContractHashSchema.nullable(),
    targetHash: TextToImageContractHashSchema,
    targetContent: z.string().max(5 * 1024 * 1024),
    state: z.enum(["pending", "applied"]),
}).strict();
const ApplyJournalSchema = z.object({
    schemaVersion: z.literal(APPLY_JOURNAL_SCHEMA_VERSION),
    migrationId: z.string().regex(/^character-migration-[a-f0-9]{24}$/u),
    state: z.enum(["prepared", "writing", "completed"]),
    previewToken: TextToImageContractHashSchema,
    writes: z.array(JournalWriteSchema).min(1).max(257),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
}).strict();
type ApplyJournal = z.infer<typeof ApplyJournalSchema>;

export type CharacterVisualMigrationResolver = Pick<TagResolverService, "resolveExplicitImportTag">;

export type CharacterVisualMigrationFileStore = {
    resolveProjectRoot(projectPath: string): Promise<string>;
    assertProjectOpen(projectPath: string, root: string): void;
    listPaths(root: string, prefix: string): Promise<string[]>;
    read(root: string, filePath: string): Promise<string | null>;
    /** upload JSON 必须按原始 bytes 读取，不能经 UTF-8 string 往返后伪造 raw hash。 */
    readBytes(root: string, filePath: string): Promise<Uint8Array | null>;
    write(input: {root: string; filePath: string; content: string; knownBefore: string | null}): Promise<void>;
    invalidate(root: string): void;
};

export type CharacterVisualMigrationErrorCode =
    | "MIGRATION_NOT_FOUND"
    | "MIGRATION_INVALID"
    | "MIGRATION_STALE"
    | "MIGRATION_BLOCKED"
    | "MIGRATION_NOT_READY"
    | "SOURCE_FILE_STALE";

/** 角色视觉迁移的稳定业务错误。 */
export class CharacterVisualMigrationError extends Error {
    readonly code: CharacterVisualMigrationErrorCode;

    constructor(code: CharacterVisualMigrationErrorCode, message: string) {
        super(message);
        this.name = "CharacterVisualMigrationError";
        this.code = code;
    }
}

type MigrationServiceOptions = {
    store?: CharacterVisualMigrationFileStore;
    resolver: CharacterVisualMigrationResolver;
    now?: () => string;
};

type CharacterVisualSourceMergeBuild = {
    preview: CharacterVisualSourceMergePreview;
    source: Chatu8CharacterVisualSourcePackage;
    sourceCharacter: Chatu8CharacterVisualSourcePackage["characters"][number];
    characterId: string;
    existing: CharacterVisualDraftGroupInput | null;
};

type CharacterVisualDirectorBuild = {
    preview: CharacterVisualDirectorPreview;
    record: CharacterVisualDirectorProposalRecord;
    characterId: string;
    existing: CharacterVisualDraftGroupInput | null;
};

/** Project 角色/服装 V2 proposal、Resolver、CAS 与 apply journal 编排器。 */
export class CharacterVisualMigrationService {
    private readonly store: CharacterVisualMigrationFileStore;
    private readonly resolver: CharacterVisualMigrationResolver;
    private readonly now: () => string;
    private readonly tails = new Map<string, Promise<void>>();

    constructor(options: MigrationServiceOptions) {
        this.store = options.store ?? new WorkspaceCharacterVisualMigrationStore();
        this.resolver = options.resolver;
        this.now = options.now ?? (() => new Date().toISOString());
    }

    /** 只读扫描旧 image-tags 与已升级 V2，不创建 proposal。 */
    async scan(input: {projectPath: string}): Promise<CharacterVisualMigrationScan> {
        const context = await this.project(input.projectPath);
        const paths = await this.store.listPaths(context.root, "lorebook/character");
        const imageTagPaths = paths.filter((filePath) => filePath.endsWith("/image-tags.md"));
        const items = [] as CharacterVisualMigrationScan["items"];
        for (const characterPath of imageTagPaths) {
            const markdown = await this.requireFile(context.root, characterPath);
            const outfitPrefix = `${characterPath.slice(0, -"/image-tags.md".length)}/outfits/`;
            const outfitCount = paths.filter((filePath) => filePath.startsWith(outfitPrefix) && filePath.endsWith(".md")).length;
            try {
                const parsedCharacter = parseCharacterImageTagsMarkdown(markdown).character;
                const characterDirectory = characterPath.slice(0, -"/image-tags.md".length);
                for (const outfitRef of parsedCharacter.outfitRefs) {
                    const outfitPath = `${characterDirectory}/${outfitRef}`;
                    const parsedOutfit = parseOutfitTagsMarkdown(await this.requireFile(context.root, outfitPath)).outfit;
                    const expectedOutfitId = outfitPath.slice(outfitPath.lastIndexOf("/") + 1, -".md".length);
                    if (parsedOutfit.ownerCharacterId !== parsedCharacter.characterId || parsedOutfit.outfitId !== expectedOutfitId) {
                        throw new CharacterVisualMigrationError("MIGRATION_INVALID", `V2 outfit owner/id 与角色目录不一致：${outfitPath}`);
                    }
                }
                items.push({characterPath, status: "v2", outfitCount});
            } catch {
                items.push({
                    characterPath,
                    status: markdown.includes("schema: nbook.character-image-tags/v2") ? "invalid_v2" : "legacy",
                    outfitCount,
                });
            }
        }
        const sourcePaths = (await this.store.listPaths(context.root, "upload"))
            .filter((filePath) => /^upload\/[^/\\]+\.json$/u.test(filePath))
            .sort(compareText);
        const pendingMigrations = [] as CharacterVisualMigrationScan["pendingMigrations"];
        const controlPaths = await this.store.listPaths(context.root, MIGRATION_ROOT);
        for (const candidatePath of controlPaths.filter((filePath) => /\/character-migration-[a-f0-9]{24}\/candidate\.json$/u.test(filePath))) {
            const candidateRaw = await this.requireFile(context.root, candidatePath);
            const candidate = CharacterVisualMigrationCandidateSchema.parse(parseJson(candidateRaw, candidatePath));
            const resolution = await this.readResolution(context.root, candidate.migrationId);
            if (resolution.stage !== "applied") {
                pendingMigrations.push({
                    migrationId: candidate.migrationId,
                    characterPath: candidate.character.path,
                    stage: resolution.stage,
                    sourceKind: candidate.source.kind,
                });
            }
        }
        pendingMigrations.sort((left, right) => compareText(left.migrationId, right.migrationId));
        return CharacterVisualMigrationScanSchema.parse({items, sourcePaths, pendingMigrations});
    }

    /** 从一个旧角色目录创建不可执行 candidate/report；重复 prepare 复用稳定 migrationId。 */
    async prepare(input: {projectPath: string; characterPath: string}): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        const characterPath = normalizeCharacterPath(input.characterPath);
        return this.withLock(`${context.root}:${characterPath}`, async () => {
            const characterMarkdown = await this.requireFile(context.root, characterPath);
            try {
                parseCharacterImageTagsMarkdown(characterMarkdown);
                throw new CharacterVisualMigrationError("MIGRATION_INVALID", "该角色已经是 Character Image Tags V2");
            } catch (error) {
                if (error instanceof CharacterVisualMigrationError) throw error;
            }
            const outfitPrefix = `${characterPath.slice(0, -"/image-tags.md".length)}/outfits/`;
            const paths = await this.store.listPaths(context.root, outfitPrefix);
            const outfits = [] as Array<{path: string; markdown: string}>;
            for (const filePath of paths.filter((candidate) => candidate.endsWith(".md"))) {
                outfits.push({path: filePath, markdown: await this.requireFile(context.root, filePath)});
            }
            const candidate = inspectLegacyCharacterVisualGroup({characterPath, characterMarkdown, outfits});
            return this.persistCandidate(context.root, candidate);
        });
    }

    /** 对一个 upload 顶层公开明文 JSON 做 strict inspect，并列出真实角色目录目标。 */
    async inspectSource(input: {projectPath: string; sourcePath: string}): Promise<CharacterVisualSourceInspection> {
        const context = await this.project(input.projectPath);
        const sourcePath = normalizeSourcePath(input.sourcePath);
        const source = await this.readSource(context.root, sourcePath);
        return CharacterVisualSourceInspectionSchema.parse({
            schemaVersion: "nbook.character-visual-source-inspection/v1",
            sourcePath,
            source,
            targets: await this.listSourceTargets(context.root),
        });
    }

    /** 只读重建一个外部角色到缺失/legacy 目标的字段冲突预览。 */
    async previewSource(input: {
        projectPath: string;
        sourcePath: string;
        sourceCharacterId: string;
        characterPath: string;
    }): Promise<CharacterVisualSourceMergePreview> {
        const context = await this.project(input.projectPath);
        return (await this.buildSourceMerge({root: context.root, ...input})).preview;
    }

    /** 复验预览 hash 与全部 conflict 决策后，生成和本地 legacy 相同的 candidate/resolution。 */
    async prepareSource(input: {
        projectPath: string;
        sourcePath: string;
        sourceCharacterId: string;
        characterPath: string;
        expectedMergePreviewHash: string;
        decisions: Array<{field: CharacterImageTagField; choice: "keep_existing" | "use_proposal"}>;
    }): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        const characterPath = normalizeCharacterPath(input.characterPath);
        return this.withLock(`${context.root}:${characterPath}`, async () => {
            const merge = await this.buildSourceMerge({root: context.root, ...input, characterPath});
            if (merge.preview.mergePreviewHash !== input.expectedMergePreviewHash) {
                throw new CharacterVisualMigrationError("MIGRATION_STALE", "外部源合并预览已变化");
            }
            const decisions = validateMergeDecisions(merge.preview.rows, input.decisions);
            const fields = materializeMergeRows(merge.preview.rows, decisions);
            const source = merge.source;
            const candidate = inspectCharacterVisualDraftGroup({
                source: {
                    kind: "chatu8_character_export",
                    sourcePath: merge.preview.sourcePath,
                    rawSourceHash: source.rawSourceHash,
                    sanitizedSourceHash: source.sanitizedSourceHash,
                    visualSourceHash: source.visualSourceHash,
                    sourceCharacterId: merge.sourceCharacter.sourceCharacterId,
                    mergePreviewHash: merge.preview.mergePreviewHash,
                },
                character: {
                    path: merge.preview.characterPath,
                    targetBaseFileHash: merge.existing?.character.targetBaseFileHash ?? null,
                    characterId: merge.characterId,
                    names: merge.preview.targetNames,
                    fields,
                    outfitRefs: merge.existing?.character.outfitRefs ?? [],
                },
                outfits: [
                    ...(merge.existing?.outfits ?? []),
                    ...merge.sourceCharacter.outfits.map((outfit) => ({
                        path: `${path.posix.dirname(merge.preview.characterPath)}/outfits/${outfit.sourceOutfitId}.md`,
                        targetBaseFileHash: null,
                        outfitId: outfit.sourceOutfitId,
                        ownerCharacterId: merge.characterId,
                        names: outfit.names,
                        fields: outfit.fields,
                    })),
                ],
                issues: merge.existing?.issues ?? [],
            });
            return this.persistCandidate(context.root, candidate);
        });
    }

    /** 持久化一次 Director report_result，并返回绑定当前 Project base 的只读 preview。 */
    async saveDirectorProposal(input: {
        projectPath: string;
        sourceCharacterPath: string;
        sourceCharacterFileHash: string;
        sessionId: number;
        invocationId: string;
        proposal: CharacterVisualDirectorProposal;
    }): Promise<CharacterVisualDirectorPreview> {
        const context = await this.project(input.projectPath);
        const sourceCharacterPath = normalizeSourceCharacterPath(input.sourceCharacterPath);
        const proposal = CharacterVisualDirectorProposalRecordSchema.shape.output.parse(input.proposal);
        if (proposal.state !== "completed" || !proposal.character) {
            throw new CharacterVisualMigrationError("MIGRATION_BLOCKED", proposal.summary);
        }
        const currentCharacter = await this.requireFile(context.root, sourceCharacterPath);
        const currentHash = createCharacterImageTagsFileHash(currentCharacter);
        if (currentHash !== input.sourceCharacterFileHash || proposal.sourceCharacterFileHash !== currentHash) {
            throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", `角色详情已变化：${sourceCharacterPath}`);
        }
        const proposalHash = hashTextToImageContract(proposal);
        const proposalIdHash = hashTextToImageContract({
            sourceCharacterPath,
            sourceCharacterFileHash: currentHash,
            proposalHash,
            sessionId: input.sessionId,
            invocationId: input.invocationId,
        });
        const proposalId = `character-proposal-${proposalIdHash.slice("sha256:".length, "sha256:".length + 24)}`;
        const record = CharacterVisualDirectorProposalRecordSchema.parse({
            schemaVersion: "nbook.character-visual-director-proposal-record/v1",
            proposalId,
            proposalHash,
            sourceCharacterPath,
            sourceCharacterFileHash: currentHash,
            profileKey: "illustration.director",
            sessionId: input.sessionId,
            invocationId: input.invocationId,
            output: proposal,
        });
        const proposalPath = this.proposalFile(proposalId);
        const content = renderJson(record);
        const existing = await this.store.read(context.root, proposalPath);
        if (existing !== null && existing !== content) {
            throw new CharacterVisualMigrationError("MIGRATION_STALE", "稳定 proposalId 的持久记录冲突");
        }
        if (existing === null) {
            await this.store.write({root: context.root, filePath: proposalPath, content, knownBefore: null});
            this.store.invalidate(context.root);
        }
        return (await this.buildDirectorPreview(context.root, record, content)).preview;
    }

    /** 复验持久 Director proposal、Project source/base 与冲突决策后创建统一 migration。 */
    async prepareDirectorProposal(input: {
        projectPath: string;
        proposalId: string;
        expectedPreviewHash: string;
        decisions: Array<{field: CharacterImageTagField; choice: "keep_existing" | "use_proposal"}>;
    }): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        return this.withLock(`${context.root}:${input.proposalId}`, async () => {
            const proposalPath = this.proposalFile(input.proposalId);
            const proposalRaw = await this.requireFile(context.root, proposalPath);
            const record = CharacterVisualDirectorProposalRecordSchema.parse(parseJson(proposalRaw, proposalPath));
            const build = await this.buildDirectorPreview(context.root, record, proposalRaw);
            if (build.preview.previewHash !== input.expectedPreviewHash) {
                throw new CharacterVisualMigrationError("MIGRATION_STALE", "Director proposal 预览已变化");
            }
            const decisions = validateMergeDecisions(build.preview.rows, input.decisions);
            const fields = materializeMergeRows(build.preview.rows, decisions);
            const proposalCharacter = build.record.output.character;
            if (!proposalCharacter) throw new CharacterVisualMigrationError("MIGRATION_BLOCKED", "Director proposal 没有 character payload");
            const candidate = inspectCharacterVisualDraftGroup({
                source: {
                    kind: "illustration_director_character",
                    proposalId: record.proposalId,
                    proposalPath,
                    proposalFileHash: createCharacterImageTagsFileHash(proposalRaw),
                    sourceCharacterPath: record.sourceCharacterPath,
                    sourceCharacterFileHash: record.sourceCharacterFileHash,
                    profileKey: "illustration.director",
                    sessionId: record.sessionId,
                    invocationId: record.invocationId,
                    previewHash: build.preview.previewHash,
                },
                character: {
                    path: build.preview.characterPath,
                    targetBaseFileHash: build.existing?.character.targetBaseFileHash ?? null,
                    characterId: build.characterId,
                    names: build.preview.targetNames,
                    fields,
                    outfitRefs: build.existing?.character.outfitRefs ?? [],
                },
                outfits: [
                    ...(build.existing?.outfits ?? []),
                    ...record.output.outfits.map((outfit, index) => ({
                        path: build.preview.outfits[index]!.targetPath,
                        targetBaseFileHash: null,
                        outfitId: path.posix.basename(build.preview.outfits[index]!.targetPath, ".md"),
                        ownerCharacterId: build.characterId,
                        names: outfit.names,
                        fields: outfit.fields,
                    })),
                ],
                issues: build.existing?.issues ?? [],
            });
            return this.persistCandidate(context.root, candidate);
        });
    }

    /** 读取当前 proposal/resolution 状态；不访问 active Tag index。 */
    async read(input: {projectPath: string; migrationId: string}): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        return this.readSnapshot(context.root, await this.readCandidate(context.root, input.migrationId));
    }

    /** 使用 active generic NovelAI Resolver 解析全部 atom；review/block 不能进入 V2。 */
    async resolve(input: {
        projectPath: string;
        migrationId: string;
        expectedPreviewToken: string;
        approvals: TagPolicyReviewApprovalInput[];
    }): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        return this.withLock(`${context.root}:${input.migrationId}`, async () => {
            const candidate = await this.readCandidate(context.root, input.migrationId);
            if (candidate.state === "blocked") throw new CharacterVisualMigrationError("MIGRATION_BLOCKED", "candidate 存在 blocking report");
            const current = await this.readResolution(context.root, candidate.migrationId);
            assertPreviewToken(candidate, current, input.expectedPreviewToken);
            const approvals = new Map(input.approvals.map((approval) => [approval.reviewRequestHash, approval]));
            if (approvals.size !== input.approvals.length) {
                throw new CharacterVisualMigrationError("MIGRATION_INVALID", "review approval 不能重复");
            }
            const resolutions: MigrationResolution["resolutions"] = [];
            const reviews: MigrationResolution["reviews"] = [];
            const blocked: MigrationResolution["blocked"] = [];
            const usedApprovals = new Set<string>();
            for (const pending of candidate.pendingAtoms) {
                const previousReview = current.reviews.find((entry) => entry.resolutionKey === pending.resolutionKey)?.review;
                const approval = previousReview ? approvals.get(previousReview.reviewRequestHash) ?? null : null;
                if (approval) usedApprovals.add(approval.reviewRequestHash);
                const result = await this.resolver.resolveExplicitImportTag({
                    runId: candidate.migrationId,
                    contextId: `character-${candidate.sourceSetHash.slice("sha256:".length, "sha256:".length + 24)}`,
                    resolutionId: `owner-${pending.resolutionKey}`,
                    sourceText: pending.atom.sourceText,
                    modelScope: {kind: "generic-novelai"},
                    approval,
                });
                collectResolverResult(pending.resolutionKey, result, resolutions, reviews, blocked);
            }
            if (usedApprovals.size !== approvals.size) {
                throw new CharacterVisualMigrationError("MIGRATION_STALE", "提交了不属于当前 review snapshot 的 approval");
            }
            const stage = blocked.length > 0 ? "blocked" : reviews.length > 0 ? "review_required" : "ready";
            const next = MigrationResolutionSchema.parse({
                schemaVersion: RESOLUTION_SCHEMA_VERSION,
                migrationId: candidate.migrationId,
                stage,
                resolutions,
                reviews,
                blocked,
                updatedAt: this.now(),
            });
            await this.writeResolution(context.root, current, next);
            return snapshot(candidate, next);
        });
    }

    /** 冻结全部用户接受项、预检所有 source hash，再创建 journal 并开始 V2 升级。 */
    async apply(input: {
        projectPath: string;
        migrationId: string;
        expectedPreviewToken: string;
        acceptedResolutionKeys: string[];
    }): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        return this.withLock(`${context.root}:${input.migrationId}`, async () => {
            const candidate = await this.readCandidate(context.root, input.migrationId);
            const resolution = await this.readResolution(context.root, candidate.migrationId);
            assertPreviewToken(candidate, resolution, input.expectedPreviewToken);
            if (resolution.stage !== "ready" || resolution.reviews.length > 0 || resolution.blocked.length > 0) {
                throw new CharacterVisualMigrationError("MIGRATION_NOT_READY", "全部 atom terminal 且无 review/block 后才能 apply");
            }
            assertAcceptedKeys(resolution.resolutions, input.acceptedResolutionKeys);
            if (candidate.source.kind === "chatu8_character_export") {
                const externalSource = candidate.source;
                const currentSource = await this.readSource(context.root, externalSource.sourcePath);
                if (currentSource.rawSourceHash !== externalSource.rawSourceHash
                    || currentSource.sanitizedSourceHash !== externalSource.sanitizedSourceHash
                    || currentSource.visualSourceHash !== externalSource.visualSourceHash
                    || !currentSource.characters.some((character) => character.sourceCharacterId === externalSource.sourceCharacterId)) {
                    throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", `外部角色源已变化：${externalSource.sourcePath}`);
                }
            } else if (candidate.source.kind === "illustration_director_character") {
                const directorSource = candidate.source;
                const [sourceCharacter, proposalRaw] = await Promise.all([
                    this.store.read(context.root, directorSource.sourceCharacterPath),
                    this.store.read(context.root, directorSource.proposalPath),
                ]);
                if (sourceCharacter === null
                    || createCharacterImageTagsFileHash(sourceCharacter) !== directorSource.sourceCharacterFileHash
                    || proposalRaw === null
                    || createCharacterImageTagsFileHash(proposalRaw) !== directorSource.proposalFileHash) {
                    throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", "Director proposal 或角色详情已变化");
                }
            }
            const resolutionMap = Object.fromEntries(resolution.resolutions.map((entry) => [entry.resolutionKey, {
                terminal: entry.terminal,
                reviewApproval: entry.reviewApproval,
            }]));
            const materialized = materializeCharacterVisualV2({candidate, resolutions: resolutionMap});
            const targets = [
                {
                    path: materialized.characterPath,
                    sourceHash: candidate.character.targetBaseFileHash,
                    targetContent: renderCharacterImageTagsMarkdown(materialized.character),
                },
                ...materialized.outfits.map((item) => ({
                    path: item.path,
                    sourceHash: candidate.outfits.find((source) => source.path === item.path)!.targetBaseFileHash,
                    targetContent: renderOutfitTagsMarkdown(item.outfit),
                })),
            ];
            for (const target of targets) {
                const current = await this.store.read(context.root, target.path);
                const currentHash = current === null ? null : createCharacterImageTagsFileHash(current);
                if (currentHash !== target.sourceHash) {
                    throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", `源文件已变化：${target.path}`);
                }
            }
            const journal = ApplyJournalSchema.parse({
                schemaVersion: APPLY_JOURNAL_SCHEMA_VERSION,
                migrationId: candidate.migrationId,
                state: "prepared",
                previewToken: input.expectedPreviewToken,
                writes: targets.map((target) => ({
                    ...target,
                    targetHash: createCharacterImageTagsFileHash(target.targetContent),
                    state: "pending",
                })),
                createdAt: this.now(),
                updatedAt: this.now(),
            });
            const journalPath = this.file(candidate.migrationId, "apply-journal.json");
            const existingJournal = await this.store.read(context.root, journalPath);
            if (existingJournal) {
                throw new CharacterVisualMigrationError("MIGRATION_STALE", "apply journal 已存在；请使用恢复入口");
            }
            await this.store.write({root: context.root, filePath: journalPath, content: renderJson(journal), knownBefore: null});
            await this.writeResolution(context.root, resolution, {...resolution, stage: "applying", updatedAt: this.now()});
            return this.executeJournal(context.root, candidate, journal, renderJson(journal));
        });
    }

    /** 恢复 prepared/writing journal；只接受 source bytes 或已写入的精确 target bytes。 */
    async resume(input: {projectPath: string; migrationId: string}): Promise<CharacterVisualMigrationSnapshot> {
        const context = await this.project(input.projectPath);
        return this.withLock(`${context.root}:${input.migrationId}`, async () => {
            const candidate = await this.readCandidate(context.root, input.migrationId);
            const journalPath = this.file(candidate.migrationId, "apply-journal.json");
            const raw = await this.store.read(context.root, journalPath);
            if (!raw) throw new CharacterVisualMigrationError("MIGRATION_NOT_FOUND", "apply journal 不存在");
            return this.executeJournal(context.root, candidate, ApplyJournalSchema.parse(parseJson(raw, journalPath)), raw);
        });
    }

    /** 串行推进目标文件与 journal；崩溃后可由 target hash 判断已完成阶段。 */
    private async executeJournal(
        root: string,
        candidate: CharacterVisualMigrationCandidate,
        initial: ApplyJournal,
        initialRaw: string,
    ): Promise<CharacterVisualMigrationSnapshot> {
        let journal = initial;
        let journalRaw = initialRaw;
        const journalPath = this.file(candidate.migrationId, "apply-journal.json");
        for (let index = 0; index < journal.writes.length; index += 1) {
            const write = journal.writes[index]!;
            const current = await this.store.read(root, write.path);
            const currentHash = current === null ? null : createOutfitTagsFileHash(current);
            if (currentHash === write.targetHash) {
                if (write.state !== "applied") {
                    journal = updateJournalWrite(journal, index, "applied", this.now());
                    const nextRaw = renderJson(journal);
                    await this.store.write({root, filePath: journalPath, content: nextRaw, knownBefore: journalRaw});
                    journalRaw = nextRaw;
                }
                continue;
            }
            if (currentHash !== write.sourceHash) {
                throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", `journal 目标既不是 source 也不是 target：${write.path}`);
            }
            if (journal.state === "prepared") {
                journal = {...journal, state: "writing", updatedAt: this.now()};
                const nextRaw = renderJson(journal);
                await this.store.write({root, filePath: journalPath, content: nextRaw, knownBefore: journalRaw});
                journalRaw = nextRaw;
            }
            await this.store.write({root, filePath: write.path, content: write.targetContent, knownBefore: current});
            journal = updateJournalWrite(journal, index, "applied", this.now());
            const nextRaw = renderJson(journal);
            await this.store.write({root, filePath: journalPath, content: nextRaw, knownBefore: journalRaw});
            journalRaw = nextRaw;
        }
        journal = ApplyJournalSchema.parse({...journal, state: "completed", updatedAt: this.now()});
        const completedRaw = renderJson(journal);
        if (completedRaw !== journalRaw) {
            await this.store.write({root, filePath: journalPath, content: completedRaw, knownBefore: journalRaw});
        }
        const resolution = await this.readResolution(root, candidate.migrationId);
        const applied = MigrationResolutionSchema.parse({...resolution, stage: "applied", updatedAt: this.now()});
        if (resolution.stage !== "applied") await this.writeResolution(root, resolution, applied);
        this.store.invalidate(root);
        return snapshot(candidate, applied);
    }

    /** 读取并 strict parse upload 原始 bytes；report-only package 仍可由 inspect 展示。 */
    private async readSource(root: string, sourcePathInput: string): Promise<Chatu8CharacterVisualSourcePackage> {
        const sourcePath = normalizeSourcePath(sourcePathInput);
        const bytes = await this.store.readBytes(root, sourcePath);
        if (!bytes) throw new CharacterVisualMigrationError("MIGRATION_NOT_FOUND", `外部角色源不存在：${sourcePath}`);
        try {
            return parseChatu8CharacterVisualSource(bytes);
        } catch (error) {
            throw new CharacterVisualMigrationError(
                "MIGRATION_INVALID",
                error instanceof Error ? `外部角色源 strict parse 失败：${error.message}` : "外部角色源 strict parse 失败",
            );
        }
    }

    /** 只从含 index.md 的真实角色目录派生目标，避免凭空猜测 Project 角色。 */
    private async listSourceTargets(root: string): Promise<CharacterVisualSourceInspection["targets"]> {
        const paths = await this.store.listPaths(root, "lorebook/character");
        const directories = paths
            .filter((filePath) => /^lorebook\/character\/[^/\\]+\/index\.md$/u.test(filePath))
            .map((filePath) => path.posix.dirname(filePath))
            .sort(compareText);
        const targets: CharacterVisualSourceInspection["targets"] = [];
        for (const directory of directories) {
            const characterId = path.posix.basename(directory);
            if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(characterId)) continue;
            const characterPath = `${directory}/image-tags.md`;
            targets.push({
                characterPath,
                characterId,
                status: await this.classifyTarget(root, characterPath, paths),
            });
        }
        return targets;
    }

    /** 目标状态判定以完整 Character/Outfit V2 owner/ref 验证为准。 */
    private async classifyTarget(
        root: string,
        characterPath: string,
        knownPaths?: string[],
    ): Promise<"missing_visual" | "legacy" | "v2" | "invalid_v2"> {
        const markdown = await this.store.read(root, characterPath);
        if (markdown === null) return "missing_visual";
        try {
            const parsedCharacter = parseCharacterImageTagsMarkdown(markdown).character;
            const characterDirectory = path.posix.dirname(characterPath);
            for (const outfitRef of parsedCharacter.outfitRefs) {
                const outfitPath = `${characterDirectory}/${outfitRef}`;
                if (knownPaths && !knownPaths.includes(outfitPath)) throw new Error(`outfit 不存在：${outfitPath}`);
                const parsedOutfit = parseOutfitTagsMarkdown(await this.requireFile(root, outfitPath)).outfit;
                const expectedOutfitId = path.posix.basename(outfitPath, ".md");
                if (parsedOutfit.ownerCharacterId !== parsedCharacter.characterId || parsedOutfit.outfitId !== expectedOutfitId) {
                    throw new Error(`outfit owner/id 不一致：${outfitPath}`);
                }
            }
            return "v2";
        } catch {
            return markdown.includes("schema: nbook.character-image-tags/v2") ? "invalid_v2" : "legacy";
        }
    }

    /** 重建 source/target draft、固定 create-only outfit 路径并生成 deterministic merge hash。 */
    private async buildSourceMerge(input: {
        root: string;
        sourcePath: string;
        sourceCharacterId: string;
        characterPath: string;
    }): Promise<CharacterVisualSourceMergeBuild> {
        const sourcePath = normalizeSourcePath(input.sourcePath);
        const characterPath = normalizeCharacterPath(input.characterPath);
        const characterDirectory = path.posix.dirname(characterPath);
        if (await this.store.read(input.root, `${characterDirectory}/index.md`) === null) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "外部源目标必须是已有 Project 角色目录");
        }
        const source = await this.readSource(input.root, sourcePath);
        if (source.state !== "proposal_ready") {
            throw new CharacterVisualMigrationError("MIGRATION_BLOCKED", "该外部源只能生成 report，不能进入迁移 proposal");
        }
        const sourceCharacter = source.characters.find((character) => character.sourceCharacterId === input.sourceCharacterId);
        if (!sourceCharacter) throw new CharacterVisualMigrationError("MIGRATION_INVALID", "外部源角色 identity 不存在");
        const paths = await this.store.listPaths(input.root, characterDirectory);
        const targetStatus = await this.classifyTarget(input.root, characterPath, paths);
        if (targetStatus === "v2" || targetStatus === "invalid_v2") {
            throw new CharacterVisualMigrationError(
                "MIGRATION_INVALID",
                targetStatus === "v2" ? "外部源迁移不覆盖已生效 V2；请使用后续 proposal 编辑入口" : "目标 V2 非法，必须先修复",
            );
        }
        const characterId = path.posix.basename(characterDirectory);
        if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(characterId)) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "目标角色目录不是稳定 characterId");
        }
        let existing: CharacterVisualDraftGroupInput | null = null;
        if (targetStatus === "legacy") {
            const outfitPrefix = `${characterDirectory}/outfits/`;
            const outfits = [] as Array<{path: string; markdown: string}>;
            for (const filePath of paths.filter((candidate) => candidate.startsWith(outfitPrefix) && candidate.endsWith(".md"))) {
                outfits.push({path: filePath, markdown: await this.requireFile(input.root, filePath)});
            }
            existing = createLegacyCharacterVisualDraftGroup({
                characterPath,
                characterMarkdown: await this.requireFile(input.root, characterPath),
                outfits,
            });
        } else if (paths.some((filePath) => filePath.startsWith(`${characterDirectory}/outfits/`) && filePath.endsWith(".md"))) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "missing_visual 目标含无法证明 owner 的既有服装文件");
        }
        const targetNames = existing
            ? {
                cn: existing.character.names.cn || sourceCharacter.names.cn,
                aliasesCn: [...existing.character.names.aliasesCn],
                en: existing.character.names.en || sourceCharacter.names.en,
            }
            : {cn: sourceCharacter.names.cn, aliasesCn: [], en: sourceCharacter.names.en};
        const rows = CHARACTER_IMAGE_TAG_FIELDS.map((field) => {
            const existingText = existing?.character.fields[field] ?? "";
            const proposalText = sourceCharacter.fields[field];
            const state = mergeRowState(existingText, proposalText);
            return {field, existingText, proposalText, state, decisionRequired: state === "conflict"};
        });
        const outfits = sourceCharacter.outfits.map((outfit) => ({
            sourceOutfitId: outfit.sourceOutfitId,
            sourceKey: outfit.sourceKey,
            targetPath: `${characterDirectory}/outfits/${outfit.sourceOutfitId}.md`,
            names: outfit.names,
        }));
        for (const outfit of outfits) {
            if (await this.store.read(input.root, outfit.targetPath) !== null) {
                throw new CharacterVisualMigrationError("MIGRATION_INVALID", `外部服装 create-only 路径已存在：${outfit.targetPath}`);
            }
        }
        const evidence = {
            schemaVersion: "nbook.character-visual-source-merge-preview/v1" as const,
            sourcePath,
            sourceCharacterId: sourceCharacter.sourceCharacterId,
            sourceHashes: {
                rawSourceHash: source.rawSourceHash,
                sanitizedSourceHash: source.sanitizedSourceHash,
                visualSourceHash: source.visualSourceHash,
            },
            characterPath,
            targetStatus,
            targetBaseSetHash: hashTextToImageContract(existing?.source.kind === "project_files"
                ? existing.source.files
                : []),
            targetNames,
            sourceNames: sourceCharacter.names,
            rows,
            outfits,
        };
        const preview = CharacterVisualSourceMergePreviewSchema.parse({
            ...evidence,
            mergePreviewHash: hashTextToImageContract(evidence),
        });
        return {preview, source, sourceCharacter, characterId, existing};
    }

    /** 从已持久 Director record 重建预览；角色详情、proposal 与视觉 target 任一漂移都会改变/阻断 hash。 */
    private async buildDirectorPreview(
        root: string,
        recordInput: CharacterVisualDirectorProposalRecord,
        proposalRaw: string,
    ): Promise<CharacterVisualDirectorBuild> {
        const record = CharacterVisualDirectorProposalRecordSchema.parse(recordInput);
        const proposalCharacter = record.output.character;
        if (record.output.state !== "completed" || !proposalCharacter) {
            throw new CharacterVisualMigrationError("MIGRATION_BLOCKED", record.output.summary);
        }
        const sourceMarkdown = await this.requireFile(root, record.sourceCharacterPath);
        if (createCharacterImageTagsFileHash(sourceMarkdown) !== record.sourceCharacterFileHash
            || record.output.sourceCharacterFileHash !== record.sourceCharacterFileHash) {
            throw new CharacterVisualMigrationError("SOURCE_FILE_STALE", `角色详情已变化：${record.sourceCharacterPath}`);
        }
        const proposalFileHash = createCharacterImageTagsFileHash(proposalRaw);
        const proposalPath = this.proposalFile(record.proposalId);
        if (await this.requireFile(root, proposalPath) !== proposalRaw) {
            throw new CharacterVisualMigrationError("MIGRATION_STALE", "Director proposal control file 已变化");
        }
        const characterDirectory = path.posix.dirname(record.sourceCharacterPath);
        const characterPath = `${characterDirectory}/image-tags.md`;
        const characterId = path.posix.basename(characterDirectory);
        const paths = await this.store.listPaths(root, characterDirectory);
        const targetStatus = await this.classifyTarget(root, characterPath, paths);
        if (targetStatus === "v2" || targetStatus === "invalid_v2") {
            throw new CharacterVisualMigrationError(
                "MIGRATION_INVALID",
                targetStatus === "v2" ? "Director proposal 不直接覆盖已生效 V2" : "目标 V2 非法，必须先修复",
            );
        }
        let existing: CharacterVisualDraftGroupInput | null = null;
        if (targetStatus === "legacy") {
            const outfits = [] as Array<{path: string; markdown: string}>;
            for (const filePath of paths.filter((candidate) => candidate.startsWith(`${characterDirectory}/outfits/`) && candidate.endsWith(".md"))) {
                outfits.push({path: filePath, markdown: await this.requireFile(root, filePath)});
            }
            existing = createLegacyCharacterVisualDraftGroup({
                characterPath,
                characterMarkdown: await this.requireFile(root, characterPath),
                outfits,
            });
        } else if (paths.some((filePath) => filePath.startsWith(`${characterDirectory}/outfits/`) && filePath.endsWith(".md"))) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "missing_visual 目标含无法证明 owner 的既有服装文件");
        }
        const sourceDocument = parseMarkdownDocument(sourceMarkdown);
        const sourceTitle = typeof sourceDocument.frontmatter.title === "string"
            ? sourceDocument.frontmatter.title.trim()
            : "";
        const sourceAliases = Array.isArray(sourceDocument.frontmatter.aliases)
            ? sourceDocument.frontmatter.aliases.filter((alias): alias is string => typeof alias === "string" && Boolean(alias.trim())).map((alias) => alias.trim())
            : [];
        const targetNames = existing
            ? existing.character.names
            : {
                cn: sourceTitle || proposalCharacter.names.cn,
                aliasesCn: sourceAliases.filter((alias) => alias !== sourceTitle).slice(0, 64),
                en: proposalCharacter.names.en,
            };
        const rows = CHARACTER_IMAGE_TAG_FIELDS.map((field) => {
            const existingText = existing?.character.fields[field] ?? "";
            const proposalText = proposalCharacter.fields[field];
            const state = mergeRowState(existingText, proposalText);
            return {field, existingText, proposalText, state, decisionRequired: state === "conflict"};
        });
        const outfits = record.output.outfits.map((outfit, index) => {
            const outfitHash = hashTextToImageContract({proposalId: record.proposalId, index, names: outfit.names});
            const outfitId = `director-outfit-${outfitHash.slice("sha256:".length, "sha256:".length + 24)}`;
            return {targetPath: `${characterDirectory}/outfits/${outfitId}.md`, names: outfit.names};
        });
        for (const outfit of outfits) {
            if (await this.store.read(root, outfit.targetPath) !== null) {
                throw new CharacterVisualMigrationError("MIGRATION_INVALID", `Director outfit create-only 路径已存在：${outfit.targetPath}`);
            }
        }
        const evidence = {
            schemaVersion: "nbook.character-visual-director-preview/v1" as const,
            proposalId: record.proposalId,
            proposalFileHash,
            sourceCharacterPath: record.sourceCharacterPath,
            sourceCharacterFileHash: record.sourceCharacterFileHash,
            characterPath,
            targetStatus,
            targetBaseSetHash: hashTextToImageContract(existing?.source.kind === "project_files" ? existing.source.files : []),
            targetNames,
            rows,
            outfits,
            diagnostics: record.output.diagnostics,
        };
        const preview = CharacterVisualDirectorPreviewSchema.parse({...evidence, previewHash: hashTextToImageContract(evidence)});
        return {preview, record, characterId, existing};
    }

    /** 以相同 create/CAS 规则持久化任一 source 的统一 candidate/report/resolution。 */
    private async persistCandidate(
        root: string,
        candidate: CharacterVisualMigrationCandidate,
    ): Promise<CharacterVisualMigrationSnapshot> {
        const candidatePath = this.file(candidate.migrationId, "candidate.json");
        const reportPath = this.file(candidate.migrationId, "report.json");
        const resolutionPath = this.file(candidate.migrationId, "resolution.json");
        const existingCandidate = await this.store.read(root, candidatePath);
        if (existingCandidate) {
            const parsed = CharacterVisualMigrationCandidateSchema.parse(parseJson(existingCandidate, candidatePath));
            if (parsed.sourceSetHash !== candidate.sourceSetHash) {
                throw new CharacterVisualMigrationError("MIGRATION_STALE", "稳定 migrationId 的 sourceSetHash 冲突");
            }
            if (!await this.store.read(root, reportPath)) {
                await this.store.write({root, filePath: reportPath, content: renderReport(parsed), knownBefore: null});
            }
            if (!await this.store.read(root, resolutionPath)) {
                await this.store.write({
                    root,
                    filePath: resolutionPath,
                    content: renderJson(createInitialResolution(parsed, this.now())),
                    knownBefore: null,
                });
            }
            return this.readSnapshot(root, parsed);
        }
        const resolution = createInitialResolution(candidate, this.now());
        await this.store.write({root, filePath: candidatePath, content: renderJson(candidate), knownBefore: null});
        await this.store.write({root, filePath: reportPath, content: renderReport(candidate), knownBefore: null});
        await this.store.write({root, filePath: resolutionPath, content: renderJson(resolution), knownBefore: null});
        this.store.invalidate(root);
        return snapshot(candidate, resolution);
    }

    /** 解析并守卫当前 Project。 */
    private async project(projectPath: string): Promise<{root: string}> {
        const root = await this.store.resolveProjectRoot(projectPath);
        if (!root) throw new CharacterVisualMigrationError("MIGRATION_INVALID", "Project Workspace root 缺失");
        this.store.assertProjectOpen(projectPath, root);
        return {root};
    }

    /** 从持久 candidate.json 读取并 strict parse。 */
    private async readCandidate(root: string, migrationId: string): Promise<CharacterVisualMigrationCandidate> {
        if (!/^character-migration-[a-f0-9]{24}$/u.test(migrationId)) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "migrationId 非法");
        }
        const filePath = this.file(migrationId, "candidate.json");
        const raw = await this.store.read(root, filePath);
        if (!raw) throw new CharacterVisualMigrationError("MIGRATION_NOT_FOUND", "migration candidate 不存在");
        return CharacterVisualMigrationCandidateSchema.parse(parseJson(raw, filePath));
    }

    /** 读取 strict resolution state。 */
    private async readResolution(root: string, migrationId: string): Promise<MigrationResolution> {
        const filePath = this.file(migrationId, "resolution.json");
        const raw = await this.store.read(root, filePath);
        if (!raw) throw new CharacterVisualMigrationError("MIGRATION_NOT_FOUND", "migration resolution 不存在");
        return MigrationResolutionSchema.parse(parseJson(raw, filePath));
    }

    /** 读取 candidate 与 resolution 并生成只读快照。 */
    private async readSnapshot(root: string, candidate: CharacterVisualMigrationCandidate): Promise<CharacterVisualMigrationSnapshot> {
        return snapshot(candidate, await this.readResolution(root, candidate.migrationId));
    }

    /** CAS 覆盖 resolution state。 */
    private async writeResolution(root: string, before: MigrationResolution, after: MigrationResolution): Promise<void> {
        const filePath = this.file(before.migrationId, "resolution.json");
        const current = await this.store.read(root, filePath);
        const expected = renderJson(MigrationResolutionSchema.parse(before));
        if (current !== expected) throw new CharacterVisualMigrationError("MIGRATION_STALE", "resolution state 已变化");
        await this.store.write({root, filePath, content: renderJson(MigrationResolutionSchema.parse(after)), knownBefore: current});
    }

    /** 要求文件存在。 */
    private async requireFile(root: string, filePath: string): Promise<string> {
        const content = await this.store.read(root, filePath);
        if (content === null) throw new CharacterVisualMigrationError("MIGRATION_NOT_FOUND", `文件不存在：${filePath}`);
        return content;
    }

    /** 返回一个 migration 控制文件路径。 */
    private file(migrationId: string, name: "candidate.json" | "report.json" | "resolution.json" | "apply-journal.json"): string {
        return `${MIGRATION_ROOT}/${migrationId}/${name}`;
    }

    /** Director proposal control file 的稳定 Project-relative 路径。 */
    private proposalFile(proposalId: string): string {
        if (!/^character-proposal-[a-f0-9]{24}$/u.test(proposalId)) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "proposalId 非法");
        }
        return `.nbook/text-to-image/character-visual-proposals/${proposalId}/proposal.json`;
    }

    /** 同一 Project/migration 的进程内串行锁；文件 CAS 继续防外部编辑。 */
    private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => tail);
        this.tails.set(key, queued);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.tails.get(key) === queued) this.tails.delete(key);
        }
    }
}

/** 生产 Project 文件存储：原路径 guard、tracked write 与 workspace index invalidate。 */
class WorkspaceCharacterVisualMigrationStore implements CharacterVisualMigrationFileStore {
    async resolveProjectRoot(projectPath: string): Promise<string> {
        const root = await resolveWorkspaceRootInput({projectPath});
        if (!root) throw new CharacterVisualMigrationError("MIGRATION_INVALID", "Project Workspace root 缺失");
        return root;
    }

    assertProjectOpen(projectPath: string, _root: string): void {
        assertProjectOpen(projectPath);
    }

    async listPaths(root: string, prefix: string): Promise<string[]> {
        const nodes = await scanWorkspaceTree({root: root as any, targets: [prefix], depth: null, recursive: true});
        return nodes.filter((node) => !node.isDirectory).map((node) => node.path).sort(compareText);
    }

    async read(root: string, filePath: string): Promise<string | null> {
        try {
            return await readWorkspaceTextFile(root as any, filePath);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    async readBytes(root: string, filePath: string): Promise<Uint8Array | null> {
        const sourcePath = normalizeSourcePath(filePath);
        let projectReal: string;
        let uploadReal: string;
        let sourceReal: string;
        try {
            projectReal = await fs.realpath(root);
            uploadReal = await fs.realpath(path.join(projectReal, "upload"));
            sourceReal = await fs.realpath(path.join(projectReal, ...sourcePath.split("/")));
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
        if (!samePath(uploadReal, path.join(projectReal, "upload"))) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "upload 目录不得通过 symlink 指向 Project 外部");
        }
        const relativePath = path.relative(uploadReal, sourceReal);
        if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath) || relativePath.includes(path.sep)) {
            throw new CharacterVisualMigrationError("MIGRATION_INVALID", "外部角色源必须位于当前 Project 的 upload 顶层");
        }
        const stat = await fs.stat(sourceReal);
        if (!stat.isFile()) throw new CharacterVisualMigrationError("MIGRATION_INVALID", "外部角色源必须是普通文件");
        return fs.readFile(sourceReal);
    }

    async write(input: {root: string; filePath: string; content: string; knownBefore: string | null}): Promise<void> {
        await writeWorkspaceTextFileTracked(writeWorkspaceTextFileTracked({...input, actor: USER_LOCAL_ACTOR} as any) as any);
    }

    invalidate(root: string): void {
        invalidateProjectWorkspaceIndexAfterMutation({target: {kind: "project-workspace", root: root, projectPath: ""}} as any);
    }
}

/** 把 Resolver 三态投影为 owner migration state。 */
function collectResolverResult(
    resolutionKey: string,
    result: TagResolverExplicitResult,
    resolutions: MigrationResolution["resolutions"],
    reviews: MigrationResolution["reviews"],
    blocked: MigrationResolution["blocked"],
): void {
    if (result.state === "review_required") {
        reviews.push({resolutionKey, review: result.review});
        return;
    }
    if (result.state === "blocked") {
        blocked.push({resolutionKey, code: result.code, sourceText: result.sourceText});
        return;
    }
    if (!("terminal" in result.run)) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "Resolver terminal result 缺少 terminal snapshot");
    }
    resolutions.push({resolutionKey, terminal: result.run.terminal, reviewApproval: result.reviewApproval});
}

/** 生成包含完整 candidate/resolution 的 stale token。 */
function snapshot(candidate: CharacterVisualMigrationCandidate, resolution: MigrationResolution): CharacterVisualMigrationSnapshot {
    return CharacterVisualMigrationSnapshotSchema.parse({
        candidate,
        stage: resolution.stage,
        resolutions: resolution.resolutions,
        reviews: resolution.reviews,
        blocked: resolution.blocked,
        previewToken: hashTextToImageContract({candidate, resolution}),
    });
}

/** 校验客户端看到的 snapshot 未漂移。 */
function assertPreviewToken(candidate: CharacterVisualMigrationCandidate, resolution: MigrationResolution, expected: string): void {
    TextToImageContractHashSchema.parse(expected);
    if (snapshot(candidate, resolution).previewToken !== expected) {
        throw new CharacterVisualMigrationError("MIGRATION_STALE", "migration preview 已失效，请刷新");
    }
}

/** apply 必须逐项接受当前全部 terminal resolution，不能漏项或添项。 */
function assertAcceptedKeys(resolutions: MigrationResolution["resolutions"], accepted: string[]): void {
    if (new Set(accepted).size !== accepted.length) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "acceptedResolutionKeys 不能重复");
    }
    const expected = resolutions.map((entry) => entry.resolutionKey).sort(compareText);
    const actual = [...accepted].sort(compareText);
    if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
        throw new CharacterVisualMigrationError("MIGRATION_NOT_READY", "必须逐项接受当前全部 terminal resolution");
    }
}

/** 更新单个 journal write 状态。 */
function updateJournalWrite(journal: ApplyJournal, index: number, state: "applied", updatedAt: string): ApplyJournal {
    return ApplyJournalSchema.parse({
        ...journal,
        writes: journal.writes.map((write, writeIndex) => writeIndex === index ? {...write, state} : write),
        updatedAt,
    });
}

/** 创建 candidate 对应的初始不可执行 resolution state。 */
function createInitialResolution(candidate: CharacterVisualMigrationCandidate, updatedAt: string): MigrationResolution {
    return MigrationResolutionSchema.parse({
        schemaVersion: RESOLUTION_SCHEMA_VERSION,
        migrationId: candidate.migrationId,
        stage: candidate.state === "blocked" ? "blocked" : "pending_unresolved",
        resolutions: [],
        reviews: [],
        blocked: [],
        updatedAt,
    });
}

/** 规范渲染人类/UI 可读取的 blocking report。 */
function renderReport(candidate: CharacterVisualMigrationCandidate): string {
    return renderJson({
        schemaVersion: "nbook.character-visual-migration-report/v1",
        migrationId: candidate.migrationId,
        state: candidate.state,
        sourceSetHash: candidate.sourceSetHash,
        source: candidate.source,
        atomCount: candidate.pendingAtoms.length,
        issues: candidate.issues,
    });
}

/** 规范 JSON 控制文件。 */
function renderJson(value: object): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/** JSON 是持久外部边界，返回 unknown 后必须立即交给 strict schema。 */
function parseJson(value: string, label: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", `${label} 不是合法 JSON`);
    }
}

/** 规范 characterPath。 */
function normalizeCharacterPath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    if (!/^lorebook\/character\/[^/\\]+\/image-tags\.md$/u.test(normalized) || normalized.includes("..")) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "characterPath 必须指向 lorebook/character/**/image-tags.md");
    }
    return normalized;
}

/** 角色事实 source 只接受现有标准角色目录的 index.md。 */
function normalizeSourceCharacterPath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
    if (!/^lorebook\/character\/[^/\\]+\/index\.md$/u.test(normalized) || normalized.includes("..")) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "sourceCharacterPath 必须指向 lorebook/character/<id>/index.md");
    }
    return normalized;
}

/** 外部角色源仅接受当前 Project upload 顶层普通 JSON。 */
function normalizeSourcePath(value: string): string {
    const parsed = CharacterVisualSourceRelativePathSchema.safeParse(value.trim().replaceAll("\\", "/"));
    if (!parsed.success) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "sourcePath 必须是 upload/<file>.json");
    }
    return parsed.data;
}

/** 视觉字段只按 trim 后 exact equality 分类，不做模糊或语义猜测。 */
function mergeRowState(existingText: string, proposalText: string): "empty" | "same" | "existing_only" | "proposal_only" | "conflict" {
    const existing = existingText.trim();
    const proposal = proposalText.trim();
    if (!existing && !proposal) return "empty";
    if (existing && !proposal) return "existing_only";
    if (!existing && proposal) return "proposal_only";
    return existing === proposal ? "same" : "conflict";
}

/** 冲突决策必须与当前 preview 的 conflict 集合精确相等。 */
function validateMergeDecisions(
    rows: CharacterVisualSourceMergePreview["rows"],
    input: Array<{field: CharacterImageTagField; choice: "keep_existing" | "use_proposal"}>,
): Map<CharacterImageTagField, "keep_existing" | "use_proposal"> {
    const decisions = new Map(input.map((decision) => [decision.field, decision.choice]));
    if (decisions.size !== input.length) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "同一冲突字段不能重复决策");
    }
    const conflictFields = new Set(rows.filter((row) => row.decisionRequired).map((row) => row.field));
    if (decisions.size !== conflictFields.size || [...decisions.keys()].some((field) => !conflictFields.has(field))) {
        throw new CharacterVisualMigrationError("MIGRATION_INVALID", "必须且只能为全部 conflict 字段提交一次决策");
    }
    return decisions;
}

/** 按 preview 三态与显式 conflict 决策生成不可执行 raw field draft。 */
function materializeMergeRows(
    rows: CharacterVisualSourceMergePreview["rows"],
    decisions: Map<CharacterImageTagField, "keep_existing" | "use_proposal">,
): Record<CharacterImageTagField, string> {
    return Object.fromEntries(rows.map((row) => {
        if (row.state === "conflict") {
            return [row.field, decisions.get(row.field) === "use_proposal" ? row.proposalText : row.existingText];
        }
        return [row.field, row.state === "proposal_only" ? row.proposalText : row.existingText || row.proposalText];
    })) as Record<CharacterImageTagField, string>;
}

/** Node ENOENT 识别。 */
function isNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Windows 使用稳定 case-fold，其他平台保持文件系统大小写语义。 */
function samePath(left: string, right: string): boolean {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === "win32"
        ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
        : normalizedLeft === normalizedRight;
}

/** locale-independent code point 顺序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
