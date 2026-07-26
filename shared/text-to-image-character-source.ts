import {z} from "zod";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const TTP_CHARACTER_VISUAL_SOURCE_SCHEMA_VERSION = "nbook.ttp-character-visual-source/v1" as const;

export const TtpSourceCharacterIdSchema = z.string().regex(/^ttp-character-[a-f0-9]{24}$/u);
export const TtpSourceOutfitIdSchema = z.string().regex(/^ttp-outfit-[a-f0-9]{24}$/u);
const SourceKeySchema = z.string().trim().min(1).max(500);
export const CharacterVisualSourceRelativePathSchema = z.string()
    .regex(/^upload\/[^/\\]+\.json$/u)
    .max(500);
export const CharacterVisualMergeFieldSchema = z.enum([
    "profileTraits", "facialAppearance", "facialBack", "upperSfw", "upperBackSfw", "lowerSfw",
    "lowerBackSfw", "upperNsfw", "upperBackNsfw", "lowerNsfw", "lowerBackNsfw", "negativePrompt",
]);
export type CharacterVisualMergeField = z.infer<typeof CharacterVisualMergeFieldSchema>;

const CharacterVisualRawFieldsSchema = z.object({
    profileTraits: z.string().max(120000),
    facialAppearance: z.string().max(120000),
    facialBack: z.string().max(120000),
    upperSfw: z.string().max(120000),
    upperBackSfw: z.string().max(120000),
    lowerSfw: z.string().max(120000),
    lowerBackSfw: z.string().max(120000),
    upperNsfw: z.string().max(120000),
    upperBackNsfw: z.string().max(120000),
    lowerNsfw: z.string().max(120000),
    lowerBackNsfw: z.string().max(120000),
    negativePrompt: z.string().max(120000),
}).strict();
const SourceCharacterFieldsSchema = CharacterVisualRawFieldsSchema.extend({negativePrompt: z.literal("")}).strict();

const SourceOutfitFieldsSchema = z.object({
    upper: z.string().max(120000),
    upperBack: z.string().max(120000),
    lower: z.string().max(120000),
    lowerBack: z.string().max(120000),
}).strict();

export const TtpCharacterVisualSourceDiagnosticSchema = z.object({
    code: z.enum([
        "ENCRYPTED_EXPORT_UNSUPPORTED",
        "TAGDATA_FORBIDDEN",
        "UNKNOWN_ROOT_FIELD",
        "SOURCE_SHAPE_INVALID",
        "UNKNOWN_CHARACTER_FIELD",
        "INVALID_CHARACTER_FIELD",
        "CHARACTER_VISUAL_EMPTY",
        "UNKNOWN_OUTFIT_FIELD",
        "INVALID_OUTFIT_FIELD",
        "OUTFIT_REF_MISSING",
        "OUTFIT_OWNER_CONFLICT",
        "OUTFIT_SHARED",
        "OUTFIT_ORPHANED",
        "IMAGES_IGNORED",
    ]),
    scope: z.enum(["root", "character", "outfit"]),
    sourceKey: SourceKeySchema.nullable(),
    message: z.string().min(1).max(1000),
}).strict();

export type TtpCharacterVisualSourceDiagnostic = z.infer<typeof TtpCharacterVisualSourceDiagnosticSchema>;

export const TtpCharacterVisualSourceOutfitSchema = z.object({
    sourceOutfitId: TtpSourceOutfitIdSchema,
    sourceKey: SourceKeySchema,
    ownerSourceCharacterId: TtpSourceCharacterIdSchema,
    names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
    fields: SourceOutfitFieldsSchema,
}).strict();

export const TtpCharacterVisualSourceCharacterSchema = z.object({
    sourceCharacterId: TtpSourceCharacterIdSchema,
    sourceKey: SourceKeySchema,
    names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
    fields: SourceCharacterFieldsSchema,
    outfits: z.array(TtpCharacterVisualSourceOutfitSchema).max(256),
}).strict().superRefine((character, context) => {
    const outfitIds = character.outfits.map((outfit) => outfit.sourceOutfitId);
    if (new Set(outfitIds).size !== outfitIds.length) {
        context.addIssue({code: "custom", path: ["outfits"], message: "source outfit identity 必须唯一"});
    }
    character.outfits.forEach((outfit, index) => {
        if (outfit.ownerSourceCharacterId !== character.sourceCharacterId) {
            context.addIssue({code: "custom", path: ["outfits", index, "ownerSourceCharacterId"], message: "outfit owner 必须绑定当前 source character"});
        }
    });
});

/** 公开明文 TTP 角色/服装 export 的脱敏、非执行 proposal source。 */
export const TtpCharacterVisualSourcePackageSchema = z.object({
    schemaVersion: z.literal(TTP_CHARACTER_VISUAL_SOURCE_SCHEMA_VERSION),
    sourceKind: z.literal("ttp-character-export"),
    state: z.enum(["proposal_ready", "report_only"]),
    rawSourceHash: TextToImageContractHashSchema,
    sanitizedSourceHash: TextToImageContractHashSchema,
    visualSourceHash: TextToImageContractHashSchema,
    characters: z.array(TtpCharacterVisualSourceCharacterSchema).max(10000),
    diagnostics: z.array(TtpCharacterVisualSourceDiagnosticSchema).max(10000),
}).strict().superRefine((source, context) => {
    if ((source.characters.length > 0) !== (source.state === "proposal_ready")) {
        context.addIssue({code: "custom", path: ["state"], message: "有可用角色时 state 必须是 proposal_ready，否则必须 report_only"});
    }
    const characterIds = source.characters.map((character) => character.sourceCharacterId);
    if (new Set(characterIds).size !== characterIds.length) {
        context.addIssue({code: "custom", path: ["characters"], message: "source character identity 必须唯一"});
    }
});

export type TtpCharacterVisualSourcePackage = z.infer<typeof TtpCharacterVisualSourcePackageSchema>;

/** 可作为公开角色视觉源合并目标的 Project 角色目录。 */
export const CharacterVisualSourceTargetSchema = z.object({
    characterPath: z.string().regex(/^lorebook\/character\/[^/\\]+\/image-tags\.md$/u).max(500),
    characterId: z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u),
    status: z.enum(["missing_visual", "legacy", "v2", "invalid_v2"]),
}).strict();

/** 对一个公开明文源执行 strict inspect 后返回的只读结果。 */
export const CharacterVisualSourceInspectionSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-source-inspection/v1"),
    sourcePath: CharacterVisualSourceRelativePathSchema,
    source: TtpCharacterVisualSourcePackageSchema,
    targets: z.array(CharacterVisualSourceTargetSchema).max(10000),
}).strict();
export type CharacterVisualSourceInspection = z.infer<typeof CharacterVisualSourceInspectionSchema>;

export const CharacterVisualSourceInspectRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    sourcePath: CharacterVisualSourceRelativePathSchema,
}).strict();

/** 单个角色视觉字段的只读三态合并预览；只有 conflict 允许提交决策。 */
export const CharacterVisualMergeRowSchema = z.object({
    field: CharacterVisualMergeFieldSchema,
    existingText: z.string().max(120000),
    proposalText: z.string().max(120000),
    state: z.enum(["empty", "same", "existing_only", "proposal_only", "conflict"]),
    decisionRequired: z.boolean(),
}).strict().superRefine((row, context) => {
    if ((row.state === "conflict") !== row.decisionRequired) {
        context.addIssue({code: "custom", path: ["decisionRequired"], message: "只有 conflict 字段需要显式决策"});
    }
});

/** 外部服装始终作为 create-only proposal，不覆盖 Project 既有服装。 */
export const CharacterVisualSourceOutfitPreviewSchema = z.object({
    sourceOutfitId: TtpSourceOutfitIdSchema,
    sourceKey: SourceKeySchema,
    targetPath: z.string().regex(/^lorebook\/character\/[^/\\]+\/outfits\/[^/\\]+\.md$/u).max(500),
    names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
}).strict();

/** 外部源与一个缺失/legacy 角色视觉目标的确定性合并预览。 */
export const CharacterVisualSourceMergePreviewSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-source-merge-preview/v1"),
    sourcePath: CharacterVisualSourceRelativePathSchema,
    sourceCharacterId: TtpSourceCharacterIdSchema,
    sourceHashes: z.object({
        rawSourceHash: TextToImageContractHashSchema,
        sanitizedSourceHash: TextToImageContractHashSchema,
        visualSourceHash: TextToImageContractHashSchema,
    }).strict(),
    characterPath: CharacterVisualSourceTargetSchema.shape.characterPath,
    targetStatus: z.enum(["missing_visual", "legacy"]),
    targetBaseSetHash: TextToImageContractHashSchema,
    targetNames: z.object({
        cn: z.string().trim().max(160),
        aliasesCn: z.array(z.string().trim().min(1).max(160)).max(64),
        en: z.string().trim().max(160),
    }).strict(),
    sourceNames: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
    rows: z.array(CharacterVisualMergeRowSchema).length(CharacterVisualMergeFieldSchema.options.length),
    outfits: z.array(CharacterVisualSourceOutfitPreviewSchema).max(256),
    mergePreviewHash: TextToImageContractHashSchema,
}).strict();
export type CharacterVisualSourceMergePreview = z.infer<typeof CharacterVisualSourceMergePreviewSchema>;

export const CharacterVisualSourcePreviewRequestSchema = CharacterVisualSourceInspectRequestSchema.extend({
    sourceCharacterId: TtpSourceCharacterIdSchema,
    characterPath: CharacterVisualSourceTargetSchema.shape.characterPath,
}).strict();

export const CharacterVisualMergeDecisionSchema = z.object({
    field: CharacterVisualMergeFieldSchema,
    choice: z.enum(["keep_existing", "use_proposal"]),
}).strict();
export type CharacterVisualMergeDecision = z.infer<typeof CharacterVisualMergeDecisionSchema>;

export const CharacterVisualSourcePrepareRequestSchema = CharacterVisualSourcePreviewRequestSchema.extend({
    expectedMergePreviewHash: TextToImageContractHashSchema,
    decisions: z.array(CharacterVisualMergeDecisionSchema).max(CharacterVisualMergeFieldSchema.options.length),
}).strict();

/** illustration.director 为角色详情生成的 proposal；不含 Provider/Recipe/最终生成参数。 */
export const CharacterVisualDirectorProposalSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-director-proposal/v1"),
    operation: z.literal("propose-character-visual"),
    state: z.enum(["completed", "blocked"]),
    summary: z.string().trim().min(1).max(2000),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    character: z.object({
        names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
        fields: CharacterVisualRawFieldsSchema,
    }).strict().nullable(),
    outfits: z.array(z.object({
        names: z.object({cn: z.string().trim().max(160), en: z.string().trim().max(160)}).strict(),
        fields: SourceOutfitFieldsSchema,
    }).strict()).max(64),
    diagnostics: z.array(z.object({
        code: z.enum(["SOURCE_FACTS_INSUFFICIENT", "AMBIGUOUS_VISUAL_FACT", "UNSUPPORTED_DYNAMIC_CONTENT"]),
        message: z.string().trim().min(1).max(1000),
    }).strict()).max(256),
}).strict().superRefine((proposal, context) => {
    if ((proposal.character !== null) !== (proposal.state === "completed")) {
        context.addIssue({code: "custom", path: ["character"], message: "completed 必须含 character；blocked 必须为空"});
    }
    if (proposal.state === "blocked" && proposal.outfits.length > 0) {
        context.addIssue({code: "custom", path: ["outfits"], message: "blocked proposal 不得包含 outfits"});
    }
});
export type CharacterVisualDirectorProposal = z.infer<typeof CharacterVisualDirectorProposalSchema>;

export const CharacterVisualDirectorProposalIdSchema = z.string().regex(/^character-proposal-[a-f0-9]{24}$/u);

/** 持久 proposal envelope 把 Agent 输出绑定到 Project source bytes 与 invocation。 */
export const CharacterVisualDirectorProposalRecordSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-director-proposal-record/v1"),
    proposalId: CharacterVisualDirectorProposalIdSchema,
    proposalHash: TextToImageContractHashSchema,
    sourceCharacterPath: z.string().regex(/^lorebook\/character\/[^/\\]+\/index\.md$/u).max(500),
    sourceCharacterFileHash: TextToImageContractHashSchema,
    profileKey: z.literal("illustration.director"),
    sessionId: z.number().int().positive(),
    invocationId: z.string().trim().min(1).max(200),
    output: CharacterVisualDirectorProposalSchema,
}).strict();
export type CharacterVisualDirectorProposalRecord = z.infer<typeof CharacterVisualDirectorProposalRecordSchema>;

/** 角色详情 proposal 与当前 legacy/missing target 的确定性冲突预览。 */
export const CharacterVisualDirectorPreviewSchema = z.object({
    schemaVersion: z.literal("nbook.character-visual-director-preview/v1"),
    proposalId: CharacterVisualDirectorProposalIdSchema,
    proposalFileHash: TextToImageContractHashSchema,
    sourceCharacterPath: CharacterVisualDirectorProposalRecordSchema.shape.sourceCharacterPath,
    sourceCharacterFileHash: TextToImageContractHashSchema,
    characterPath: CharacterVisualSourceTargetSchema.shape.characterPath,
    targetStatus: z.enum(["missing_visual", "legacy"]),
    targetBaseSetHash: TextToImageContractHashSchema,
    targetNames: CharacterVisualSourceMergePreviewSchema.shape.targetNames,
    rows: z.array(CharacterVisualMergeRowSchema).length(CharacterVisualMergeFieldSchema.options.length),
    outfits: z.array(z.object({
        targetPath: CharacterVisualSourceOutfitPreviewSchema.shape.targetPath,
        names: CharacterVisualSourceOutfitPreviewSchema.shape.names,
    }).strict()).max(64),
    diagnostics: CharacterVisualDirectorProposalSchema.shape.diagnostics,
    previewHash: TextToImageContractHashSchema,
}).strict();
export type CharacterVisualDirectorPreview = z.infer<typeof CharacterVisualDirectorPreviewSchema>;

export const CharacterVisualDirectorGenerateRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    characterPath: CharacterVisualDirectorProposalRecordSchema.shape.sourceCharacterPath,
}).strict();

export const CharacterVisualDirectorGenerateResultSchema = z.discriminatedUnion("state", [
    z.object({
        state: z.literal("proposal_ready"),
        sessionId: z.number().int().positive(),
        invocationId: z.string().trim().min(1).max(200),
        preview: CharacterVisualDirectorPreviewSchema,
    }).strict(),
    z.object({
        state: z.literal("blocked"),
        sessionId: z.number().int().positive(),
        invocationId: z.string().trim().min(1).max(200),
        summary: z.string().trim().min(1).max(2000),
        diagnostics: CharacterVisualDirectorProposalSchema.shape.diagnostics,
    }).strict(),
]);
export type CharacterVisualDirectorGenerateResult = z.infer<typeof CharacterVisualDirectorGenerateResultSchema>;

export const CharacterVisualDirectorPrepareRequestSchema = z.object({
    projectPath: z.string().trim().min(1).max(500),
    proposalId: CharacterVisualDirectorProposalIdSchema,
    expectedPreviewHash: TextToImageContractHashSchema,
    decisions: z.array(CharacterVisualMergeDecisionSchema).max(CharacterVisualMergeFieldSchema.options.length),
}).strict();
