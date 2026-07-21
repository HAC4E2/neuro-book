import {z} from "zod";
import {PendingTagAtomSchema} from "nbook/shared/text-to-image-storyboard-import";
import {
    TagPolicyReviewRequestSchema,
    TagResolverPolicyApprovalSchema,
} from "nbook/shared/text-to-image-tag-resolver";
import {
    SemanticTagResolutionSchema,
    TextToImageContractHashSchema,
} from "nbook/shared/text-to-image-tag-resolution";

export const CHARACTER_VISUAL_MIGRATION_SCHEMA_VERSION = "nbook.character-visual-migration/v2" as const;

const MigrationPathSchema = z.string().trim().min(1).max(500).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\]+$/u);
const MigrationStableIdSchema = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u);
const MigrationIdSchema = z.string().regex(/^character-migration-[a-f0-9]{24}$/u);
const MigrationResolutionKeySchema = z.string().regex(/^tag-[a-f0-9]{24}$/u);
const MigrationSyntaxKeySchema = z.string().regex(/^syntax-[a-f0-9]{24}$/u);
const MigrationSourceSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("project_files"),
        files: z.array(z.object({
            path: MigrationPathSchema,
            fileHash: TextToImageContractHashSchema,
        }).strict()).min(1).max(257),
    }).strict(),
    z.object({
        kind: z.literal("chatu8_character_export"),
        sourcePath: MigrationPathSchema.regex(/^upload\/[^/\\]+\.json$/u),
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        visualSourceHash: TextToImageContractHashSchema,
        sourceCharacterId: z.string().regex(/^chatu8-character-[a-f0-9]{24}$/u),
        mergePreviewHash: TextToImageContractHashSchema,
    }).strict(),
    z.object({
        kind: z.literal("illustration_director_character"),
        proposalId: z.string().regex(/^character-proposal-[a-f0-9]{24}$/u),
        proposalPath: MigrationPathSchema.regex(/^\.nbook\/text-to-image\/character-visual-proposals\/character-proposal-[a-f0-9]{24}\/proposal\.json$/u),
        proposalFileHash: TextToImageContractHashSchema,
        sourceCharacterPath: MigrationPathSchema.regex(/^lorebook\/character\/[^/\\]+\/index\.md$/u),
        sourceCharacterFileHash: TextToImageContractHashSchema,
        profileKey: z.literal("illustration.director"),
        sessionId: z.number().int().positive(),
        invocationId: z.string().trim().min(1).max(200),
        previewHash: TextToImageContractHashSchema,
    }).strict(),
]);
const CharacterMigrationFieldsSchema = z.object({
    profileTraits: z.array(MigrationResolutionKeySchema), facialAppearance: z.array(MigrationResolutionKeySchema),
    facialBack: z.array(MigrationResolutionKeySchema), upperSfw: z.array(MigrationResolutionKeySchema),
    upperBackSfw: z.array(MigrationResolutionKeySchema), lowerSfw: z.array(MigrationResolutionKeySchema),
    lowerBackSfw: z.array(MigrationResolutionKeySchema), upperNsfw: z.array(MigrationResolutionKeySchema),
    upperBackNsfw: z.array(MigrationResolutionKeySchema), lowerNsfw: z.array(MigrationResolutionKeySchema),
    lowerBackNsfw: z.array(MigrationResolutionKeySchema), negativePrompt: z.array(MigrationResolutionKeySchema),
}).strict();
const OutfitMigrationFieldsSchema = z.object({
    upper: z.array(MigrationResolutionKeySchema), upperBack: z.array(MigrationResolutionKeySchema),
    lower: z.array(MigrationResolutionKeySchema), lowerBack: z.array(MigrationResolutionKeySchema),
}).strict();

export const CharacterVisualMigrationIssueSchema = z.object({
    code: z.enum(["UNKNOWN_PROVIDER_SYNTAX", "OUTFIT_PATH_MISMATCH", "OUTFIT_OWNER_MISMATCH", "OUTFIT_REF_MISSING"]),
    severity: z.literal("blocking"),
    path: z.string().min(1).max(1000),
    message: z.string().min(1).max(1000),
}).strict();

export const CharacterVisualPendingAtomSchema = z.object({
    resolutionKey: MigrationResolutionKeySchema,
    ownerPath: MigrationPathSchema,
    atom: PendingTagAtomSchema,
    syntaxKey: MigrationSyntaxKeySchema.nullable(),
    syntax: z.object({kind: z.literal("novelai-tag-weight"), weight: z.literal(1.1)}).strict().nullable(),
}).strict().superRefine((item, context) => {
    if ((item.syntax === null) !== (item.syntaxKey === null)) {
        context.addIssue({code: "custom", path: ["syntaxKey"], message: "syntax 与 syntaxKey 必须同时存在或同时为空"});
    }
});

export const CharacterVisualMigrationCandidateSchema = z.object({
    schemaVersion: z.literal(CHARACTER_VISUAL_MIGRATION_SCHEMA_VERSION),
    migrationId: MigrationIdSchema,
    sourceSetHash: TextToImageContractHashSchema,
    source: MigrationSourceSchema,
    state: z.enum(["pending_unresolved", "blocked"]),
    character: z.object({
        path: MigrationPathSchema,
        /** null 表示 apply 时必须 create-only；非空表示必须命中该 target base file hash。 */
        targetBaseFileHash: TextToImageContractHashSchema.nullable(),
        characterId: MigrationStableIdSchema,
        names: z.object({
            cn: z.string().trim().max(160),
            aliasesCn: z.array(z.string().trim().min(1).max(160)).max(64),
            en: z.string().trim().max(160),
        }).strict(),
        fields: CharacterMigrationFieldsSchema,
        outfitRefs: z.array(z.string().regex(/^outfits\/[^/\\]+\.md$/u)).max(256),
    }).strict(),
    outfits: z.array(z.object({
        path: MigrationPathSchema,
        /** null 表示 apply 时必须 create-only；非空表示必须命中该 target base file hash。 */
        targetBaseFileHash: TextToImageContractHashSchema.nullable(),
        outfitId: MigrationStableIdSchema,
        ownerCharacterId: MigrationStableIdSchema,
        names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
        fields: OutfitMigrationFieldsSchema,
    }).strict()).max(256),
    pendingAtoms: z.array(CharacterVisualPendingAtomSchema).max(10000),
    issues: z.array(CharacterVisualMigrationIssueSchema).max(10000),
}).strict().superRefine((candidate, context) => {
    if ((candidate.issues.length > 0) !== (candidate.state === "blocked")) {
        context.addIssue({code: "custom", path: ["state"], message: "blocking issue 与 candidate state 不一致"});
    }
    const keys = candidate.pendingAtoms.map((item) => item.resolutionKey);
    if (new Set(keys).size !== keys.length) {
        context.addIssue({code: "custom", path: ["pendingAtoms"], message: "resolutionKey 必须唯一"});
    }
});

export type CharacterVisualMigrationIssueCode = z.infer<typeof CharacterVisualMigrationIssueSchema>["code"];
export type CharacterVisualMigrationIssue = z.infer<typeof CharacterVisualMigrationIssueSchema>;
export type CharacterVisualPendingAtom = z.infer<typeof CharacterVisualPendingAtomSchema>;
export type CharacterVisualMigrationCandidate = z.infer<typeof CharacterVisualMigrationCandidateSchema>;
export type CharacterVisualMigrationCharacter = CharacterVisualMigrationCandidate["character"];
export type CharacterVisualMigrationOutfit = CharacterVisualMigrationCandidate["outfits"][number];

export const CharacterVisualMigrationResolutionEntrySchema = z.object({
    resolutionKey: MigrationResolutionKeySchema,
    terminal: SemanticTagResolutionSchema,
    reviewApproval: TagResolverPolicyApprovalSchema.nullable(),
}).strict();
export const CharacterVisualMigrationReviewEntrySchema = z.object({
    resolutionKey: MigrationResolutionKeySchema,
    review: TagPolicyReviewRequestSchema,
}).strict();
export const CharacterVisualMigrationBlockedEntrySchema = z.object({
    resolutionKey: MigrationResolutionKeySchema,
    code: z.enum(["TAG_POLICY_BLOCKED", "TAG_DEPRECATED_NOT_EXECUTABLE"]),
    sourceText: z.string().min(1).max(500),
}).strict();
export const CharacterVisualMigrationStageSchema = z.enum([
    "pending_unresolved", "review_required", "blocked", "ready", "applying", "applied",
]);

/** 设置页读取的完整可审查迁移快照；不含 target Markdown 或 journal 内容。 */
export const CharacterVisualMigrationSnapshotSchema = z.object({
    candidate: CharacterVisualMigrationCandidateSchema,
    stage: CharacterVisualMigrationStageSchema,
    resolutions: z.array(CharacterVisualMigrationResolutionEntrySchema).max(10000),
    reviews: z.array(CharacterVisualMigrationReviewEntrySchema).max(10000),
    blocked: z.array(CharacterVisualMigrationBlockedEntrySchema).max(10000),
    previewToken: TextToImageContractHashSchema,
}).strict();
export type CharacterVisualMigrationSnapshot = z.infer<typeof CharacterVisualMigrationSnapshotSchema>;

export const CharacterVisualMigrationScanSchema = z.object({
    items: z.array(z.object({
        characterPath: MigrationPathSchema,
        status: z.enum(["legacy", "v2", "invalid_v2"]),
        outfitCount: z.number().int().nonnegative().max(256),
    }).strict()).max(10000),
    sourcePaths: z.array(z.string().regex(/^upload\/[^/\\]+\.json$/u).max(500)).max(10000),
    pendingMigrations: z.array(z.object({
        migrationId: MigrationIdSchema,
        characterPath: MigrationPathSchema,
        stage: CharacterVisualMigrationStageSchema.exclude(["applied"]),
        sourceKind: z.enum(["project_files", "chatu8_character_export", "illustration_director_character"]),
    }).strict()).max(10000),
}).strict();
export type CharacterVisualMigrationScan = z.infer<typeof CharacterVisualMigrationScanSchema>;

export const CharacterVisualMigrationProjectRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
}).strict();
export const CharacterVisualMigrationPrepareRequestSchema = CharacterVisualMigrationProjectRequestSchema.extend({
    characterPath: MigrationPathSchema,
}).strict();
export const CharacterVisualMigrationReadRequestSchema = CharacterVisualMigrationProjectRequestSchema.extend({
    migrationId: MigrationIdSchema,
}).strict();
export const CharacterVisualMigrationResolveRequestSchema = CharacterVisualMigrationReadRequestSchema.extend({
    expectedPreviewToken: TextToImageContractHashSchema,
    approvals: z.array(z.object({
        reviewRequestHash: TextToImageContractHashSchema,
        reason: z.string().trim().min(1).max(500),
    }).strict()).max(10000),
}).strict();
export const CharacterVisualMigrationApplyRequestSchema = CharacterVisualMigrationReadRequestSchema.extend({
    expectedPreviewToken: TextToImageContractHashSchema,
    acceptedResolutionKeys: z.array(MigrationResolutionKeySchema).max(10000),
}).strict();
