import {z} from "zod";
import {
    hashTextToImageContract,
    type TextToImageContractValue,
} from "nbook/shared/text-to-image-contract-hash";
import {
    createSemanticTagResolutionHash,
    SemanticTagResolutionSchema,
    type SemanticTagResolution,
} from "nbook/shared/text-to-image-tag-resolution";
import {
    ProviderSyntaxNodeSchema,
    type ProviderSyntaxNode,
} from "nbook/shared/text-to-image-provider-registry";
import {
    createTagPolicyApprovalHash,
    TagPolicyApprovalSchema,
    type TagPolicyApproval,
} from "nbook/shared/text-to-image-tag-policy";

export {ProviderSyntaxNodeSchema, type ProviderSyntaxNode} from "nbook/shared/text-to-image-provider-registry";

export const CHARACTER_IMAGE_TAGS_SCHEMA = "nbook.character-image-tags/v2" as const;
export const OUTFIT_TAGS_SCHEMA = "nbook.outfit-tags/v2" as const;

export const CHARACTER_IMAGE_TAG_FIELDS = [
    "profileTraits",
    "facialAppearance",
    "facialBack",
    "upperSfw",
    "upperBackSfw",
    "lowerSfw",
    "lowerBackSfw",
    "upperNsfw",
    "upperBackNsfw",
    "lowerNsfw",
    "lowerBackNsfw",
    "negativePrompt",
] as const;

export const OUTFIT_TAG_FIELDS = ["upper", "upperBack", "lower", "lowerBack"] as const;

export const CharacterImageTagFieldSchema = z.enum(CHARACTER_IMAGE_TAG_FIELDS);
export const OutfitTagFieldSchema = z.enum(OUTFIT_TAG_FIELDS);
export type CharacterImageTagField = z.infer<typeof CharacterImageTagFieldSchema>;
export type OutfitTagField = z.infer<typeof OutfitTagFieldSchema>;

export const VisualStableIdSchema = z.string().trim().min(1).max(160)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u, "稳定 ID 不能包含路径分隔符、冒号或控制语法");
const OutfitRefSchema = z.string().trim().min(1).max(320)
    .regex(/^outfits\/[\p{L}\p{N}][\p{L}\p{N}._-]*\.md$/u, "outfitRefs 必须是同角色目录下的 outfits/<id>.md");
const VisualResolutionScopeSchema = z.object({
    providerKind: z.literal("novelai"),
    modelScope: z.object({kind: z.literal("generic-novelai")}).strict(),
}).strict();
const ResolutionKeyArraySchema = z.array(VisualStableIdSchema).max(256);

const CharacterFieldsSchema = z.object({
    profileTraits: ResolutionKeyArraySchema,
    facialAppearance: ResolutionKeyArraySchema,
    facialBack: ResolutionKeyArraySchema,
    upperSfw: ResolutionKeyArraySchema,
    upperBackSfw: ResolutionKeyArraySchema,
    lowerSfw: ResolutionKeyArraySchema,
    lowerBackSfw: ResolutionKeyArraySchema,
    upperNsfw: ResolutionKeyArraySchema,
    upperBackNsfw: ResolutionKeyArraySchema,
    lowerNsfw: ResolutionKeyArraySchema,
    lowerBackNsfw: ResolutionKeyArraySchema,
    negativePrompt: ResolutionKeyArraySchema,
}).strict();

const OutfitFieldsSchema = z.object({
    upper: ResolutionKeyArraySchema,
    upperBack: ResolutionKeyArraySchema,
    lower: ResolutionKeyArraySchema,
    lowerBack: ResolutionKeyArraySchema,
}).strict();

const CharacterNamesSchema = z.object({
    cn: z.string().trim().max(160),
    aliasesCn: z.array(z.string().trim().min(1).max(160)).max(64),
    en: z.string().trim().max(160),
}).strict().superRefine((names, context) => {
    addDuplicateIssues(names.aliasesCn, ["aliasesCn"], "中文别名", context);
    if (!names.cn && !names.en && names.aliasesCn.length === 0) {
        context.addIssue({code: "custom", message: "角色至少需要一个显示名称"});
    }
});

const OutfitNamesSchema = z.object({
    cn: z.string().trim().max(160),
    en: z.string().trim().max(160),
}).strict().superRefine((names, context) => {
    if (!names.cn && !names.en) {
        context.addIssue({code: "custom", message: "服装至少需要一个显示名称"});
    }
});

/** 角色 V2 的严格可执行 frontmatter；Markdown 正文不属于该合同。 */
export const CharacterImageTagsSchema = z.object({
    schema: z.literal(CHARACTER_IMAGE_TAGS_SCHEMA),
    characterId: VisualStableIdSchema,
    names: CharacterNamesSchema,
    resolutionScope: VisualResolutionScopeSchema,
    fields: CharacterFieldsSchema,
    outfitRefs: z.array(OutfitRefSchema).max(256),
    fieldProviderSyntaxRefs: z.partialRecord(CharacterImageTagFieldSchema, z.array(VisualStableIdSchema).max(128)),
    providerSyntaxNodes: z.record(VisualStableIdSchema, ProviderSyntaxNodeSchema),
    tagResolutions: z.record(VisualStableIdSchema, SemanticTagResolutionSchema),
    policyApprovals: z.record(VisualStableIdSchema, TagPolicyApprovalSchema),
}).strict().superRefine((character, context) => {
    addDuplicateIssues(character.outfitRefs, ["outfitRefs"], "outfit ref", context);
    collectVisualIssues(character, CHARACTER_IMAGE_TAG_FIELDS, `character:${character.characterId}`).forEach((issue) => {
        context.addIssue({code: "custom", path: issue.path, message: issue.message});
    });
});

/** 服装 V2 的严格可执行 frontmatter；owner 的路径一致性由 Project service 校验。 */
export const OutfitTagsSchema = z.object({
    schema: z.literal(OUTFIT_TAGS_SCHEMA),
    outfitId: VisualStableIdSchema,
    ownerCharacterId: VisualStableIdSchema,
    names: OutfitNamesSchema,
    resolutionScope: VisualResolutionScopeSchema,
    fields: OutfitFieldsSchema,
    fieldProviderSyntaxRefs: z.partialRecord(OutfitTagFieldSchema, z.array(VisualStableIdSchema).max(128)),
    providerSyntaxNodes: z.record(VisualStableIdSchema, ProviderSyntaxNodeSchema),
    tagResolutions: z.record(VisualStableIdSchema, SemanticTagResolutionSchema),
    policyApprovals: z.record(VisualStableIdSchema, TagPolicyApprovalSchema),
}).strict().superRefine((outfit, context) => {
    collectVisualIssues(outfit, OUTFIT_TAG_FIELDS, `outfit:${outfit.ownerCharacterId}/${outfit.outfitId}`).forEach((issue) => {
        context.addIssue({code: "custom", path: issue.path, message: issue.message});
    });
});

export type CharacterImageTags = z.infer<typeof CharacterImageTagsSchema>;
export type OutfitTags = z.infer<typeof OutfitTagsSchema>;

export type CharacterImageTagHashes = {
    visualPlanningFactsHash: string;
    renderTagFactsHash: string;
};

type VisualContractIssue = {path: Array<string | number>; message: string};
type VisualDocument<TField extends string> = {
    fields: Record<TField, string[]>;
    fieldProviderSyntaxRefs: Partial<Record<TField, string[]>>;
    providerSyntaxNodes: Record<string, ProviderSyntaxNode>;
    tagResolutions: Record<string, SemanticTagResolution>;
    policyApprovals: Record<string, TagPolicyApproval>;
};

/** 规范角色合同中的集合与 map 顺序，保证 renderer 与 hash 不依赖 YAML 输入顺序。 */
export function canonicalizeCharacterImageTags(input: CharacterImageTags): CharacterImageTags {
    const character = CharacterImageTagsSchema.parse(input);
    return CharacterImageTagsSchema.parse({
        ...character,
        fields: sortFields(character.fields, CHARACTER_IMAGE_TAG_FIELDS),
        outfitRefs: [...character.outfitRefs].sort(compareText),
        fieldProviderSyntaxRefs: sortFieldRefs(character.fieldProviderSyntaxRefs, CHARACTER_IMAGE_TAG_FIELDS),
        providerSyntaxNodes: sortSyntaxNodes(character.providerSyntaxNodes),
        tagResolutions: sortMap(character.tagResolutions),
        policyApprovals: sortMap(character.policyApprovals),
    });
}

/** 规范服装合同中的集合与 map 顺序，保证 renderer 与 hash 不依赖 YAML 输入顺序。 */
export function canonicalizeOutfitTags(input: OutfitTags): OutfitTags {
    const outfit = OutfitTagsSchema.parse(input);
    return OutfitTagsSchema.parse({
        ...outfit,
        fields: sortFields(outfit.fields, OUTFIT_TAG_FIELDS),
        fieldProviderSyntaxRefs: sortFieldRefs(outfit.fieldProviderSyntaxRefs, OUTFIT_TAG_FIELDS),
        providerSyntaxNodes: sortSyntaxNodes(outfit.providerSyntaxNodes),
        tagResolutions: sortMap(outfit.tagResolutions),
        policyApprovals: sortMap(outfit.policyApprovals),
    });
}

/** 计算角色身份/语义规划事实与精确渲染事实的独立 hash。 */
export function createCharacterImageTagHashes(input: CharacterImageTags): CharacterImageTagHashes {
    const character = canonicalizeCharacterImageTags(input);
    return createVisualHashes({
        planningIdentity: {
            schema: character.schema,
            characterId: character.characterId,
            names: character.names,
            outfitRefs: character.outfitRefs,
        },
        resolutionScope: character.resolutionScope,
        fields: character.fields,
        fieldOrder: CHARACTER_IMAGE_TAG_FIELDS,
        fieldProviderSyntaxRefs: character.fieldProviderSyntaxRefs,
        providerSyntaxNodes: character.providerSyntaxNodes,
        tagResolutions: character.tagResolutions,
        policyApprovals: character.policyApprovals,
    });
}

/** 计算服装身份/语义规划事实与精确渲染事实的独立 hash。 */
export function createOutfitTagHashes(input: OutfitTags): CharacterImageTagHashes {
    const outfit = canonicalizeOutfitTags(input);
    return createVisualHashes({
        planningIdentity: {
            schema: outfit.schema,
            outfitId: outfit.outfitId,
            ownerCharacterId: outfit.ownerCharacterId,
            names: outfit.names,
        },
        resolutionScope: outfit.resolutionScope,
        fields: outfit.fields,
        fieldOrder: OUTFIT_TAG_FIELDS,
        fieldProviderSyntaxRefs: outfit.fieldProviderSyntaxRefs,
        providerSyntaxNodes: outfit.providerSyntaxNodes,
        tagResolutions: outfit.tagResolutions,
        policyApprovals: outfit.policyApprovals,
    });
}

/** 收集 resolution 与 Provider syntax 的同文件、单字段所有权错误。 */
function collectVisualIssues<TField extends string>(
    document: VisualDocument<TField>,
    fieldOrder: readonly TField[],
    ownerIdentity: string,
): VisualContractIssue[] {
    const issues: VisualContractIssue[] = [];
    const resolutionOwners = new Map<string, TField>();
    const syntaxOwners = new Map<string, TField>();

    for (const field of fieldOrder) {
        for (const [index, resolutionKey] of document.fields[field].entries()) {
            if (!document.tagResolutions[resolutionKey]) {
                issues.push({path: ["fields", field, index], message: `未知 resolution：${resolutionKey}`});
            }
            const owner = resolutionOwners.get(resolutionKey);
            if (owner) {
                issues.push({path: ["fields", field, index], message: `resolution ${resolutionKey} 只能使用一次，已属于 ${owner}`});
            } else {
                resolutionOwners.set(resolutionKey, field);
            }
        }
        for (const [index, syntaxKey] of (document.fieldProviderSyntaxRefs[field] ?? []).entries()) {
            if (!document.providerSyntaxNodes[syntaxKey]) {
                issues.push({path: ["fieldProviderSyntaxRefs", field, index], message: `未知 Provider syntax node：${syntaxKey}`});
            }
            const owner = syntaxOwners.get(syntaxKey);
            if (owner) {
                issues.push({path: ["fieldProviderSyntaxRefs", field, index], message: `Provider syntax node ${syntaxKey} 只能引用一次，已属于 ${owner}`});
            } else {
                syntaxOwners.set(syntaxKey, field);
            }
        }
    }
    for (const [resolutionKey, resolution] of Object.entries(document.tagResolutions)) {
        if (!resolutionOwners.has(resolutionKey)) {
            issues.push({path: ["tagResolutions", resolutionKey], message: `resolution ${resolutionKey} 未被任何字段引用`});
        }
        if (resolution.providerKind !== "novelai" || resolution.modelScope.kind !== "generic-novelai") {
            issues.push({path: ["tagResolutions", resolutionKey, "modelScope"], message: "角色/服装只能保存 generic-novelai resolution"});
        }
    }
    for (const [resolutionKey, approval] of Object.entries(document.policyApprovals)) {
        const resolution = document.tagResolutions[resolutionKey];
        const ownerField = resolutionOwners.get(resolutionKey);
        if (!resolution || !ownerField) {
            issues.push({path: ["policyApprovals", resolutionKey], message: `approval 引用了未知 resolution：${resolutionKey}`});
            continue;
        }
        if (approval.resolutionKey !== resolutionKey) {
            issues.push({path: ["policyApprovals", resolutionKey, "resolutionKey"], message: "approval resolutionKey 必须与 map key 一致"});
        }
        if (approval.ownerIdentity !== ownerIdentity) {
            issues.push({path: ["policyApprovals", resolutionKey, "ownerIdentity"], message: "approval ownerIdentity 必须属于当前文件"});
        }
        const expectedSlot = ownerIdentity.startsWith("character:") ? `character:${ownerField}` : `outfit:${ownerField}`;
        if (approval.ownerSlot !== expectedSlot) {
            issues.push({path: ["policyApprovals", resolutionKey, "ownerSlot"], message: "approval ownerSlot 必须匹配 resolution 所在字段"});
        }
        if (approval.policyVersion !== resolution.policyVersion
            || approval.sourceTextHash !== hashTextToImageContract({sourceText: resolution.sourceText})
            || !approvalSubjectMatches(approval.subject, resolution)) {
            issues.push({path: ["policyApprovals", resolutionKey], message: "approval 必须绑定当前 terminal resolution"});
        }
    }
    for (const [syntaxKey, node] of Object.entries(document.providerSyntaxNodes)) {
        const owner = syntaxOwners.get(syntaxKey);
        if (!owner) {
            issues.push({path: ["providerSyntaxNodes", syntaxKey], message: `Provider syntax node ${syntaxKey} 未被任何字段引用`});
            continue;
        }
        const ownedResolutions = new Set(document.fields[owner]);
        node.resolutionKeys.forEach((resolutionKey, index) => {
            if (!ownedResolutions.has(resolutionKey)) {
                issues.push({
                    path: ["providerSyntaxNodes", syntaxKey, "resolutionKeys", index],
                    message: `Provider syntax node 只能绑定同字段 ${owner} 内的 resolution`,
                });
            }
        });
    }
    if (Object.keys(document.tagResolutions).length > 500 || Object.keys(document.providerSyntaxNodes).length > 500) {
        issues.push({path: [], message: "单个角色/服装文件最多保存 500 个 resolution 与 syntax node"});
    }
    return issues;
}

/** 按 sourceText 构造规划语义，按完整 resolution semantic hash 构造渲染语义。 */
function createVisualHashes<TField extends string>(input: {
    planningIdentity: TextToImageContractValue;
    resolutionScope: {providerKind: "novelai"; modelScope: {kind: "generic-novelai"}};
    fields: Record<TField, string[]>;
    fieldOrder: readonly TField[];
    fieldProviderSyntaxRefs: Partial<Record<TField, string[]>>;
    providerSyntaxNodes: Record<string, ProviderSyntaxNode>;
    tagResolutions: Record<string, SemanticTagResolution>;
    policyApprovals: Record<string, TagPolicyApproval>;
}): CharacterImageTagHashes {
    const planningFields: {[key: string]: TextToImageContractValue} = {};
    const renderFields: {[key: string]: TextToImageContractValue} = {};
    const syntaxRefs: {[key: string]: TextToImageContractValue} = {};
    for (const field of input.fieldOrder) {
        planningFields[field] = input.fields[field].map((key) => input.tagResolutions[key]!.sourceText);
        renderFields[field] = [...input.fields[field]];
        const refs = input.fieldProviderSyntaxRefs[field];
        if (refs && refs.length > 0) syntaxRefs[field] = [...refs];
    }
    const semanticResolutions: {[key: string]: TextToImageContractValue} = {};
    for (const [key, resolution] of Object.entries(input.tagResolutions)) {
        semanticResolutions[key] = createSemanticTagResolutionHash(resolution);
    }
    const semanticApprovals: {[key: string]: TextToImageContractValue} = {};
    for (const [key, approval] of Object.entries(input.policyApprovals)) {
        semanticApprovals[key] = createTagPolicyApprovalHash(approval);
    }
    return {
        visualPlanningFactsHash: hashTextToImageContract({
            identity: input.planningIdentity,
            fields: planningFields,
        }),
        renderTagFactsHash: hashTextToImageContract({
            resolutionScope: input.resolutionScope,
            fields: renderFields,
            fieldProviderSyntaxRefs: syntaxRefs,
            providerSyntaxNodes: input.providerSyntaxNodes,
            tagResolutionHashes: semanticResolutions,
            policyApprovalHashes: semanticApprovals,
        }),
    };
}

/** approval subject 不能借 canonical/passthrough 形态变化复用。 */
function approvalSubjectMatches(subject: TagPolicyApproval["subject"], resolution: SemanticTagResolution): boolean {
    if (resolution.kind === "provider_passthrough") {
        return subject.kind === "provider_passthrough" && subject.validationTextHash === resolution.validationTextHash;
    }
    return subject.kind === "canonical"
        && subject.tagId === resolution.canonical.tagId
        && subject.canonicalName === resolution.canonical.canonicalName;
}

/** 为 string 数组添加重复项错误。 */
function addDuplicateIssues(
    values: string[],
    path: Array<string | number>,
    label: string,
    context: z.core.$RefinementCtx,
): void {
    const seen = new Set<string>();
    values.forEach((value, index) => {
        if (seen.has(value)) {
            context.addIssue({code: "custom", path: [...path, index], message: `${label} 不能重复：${value}`});
        }
        seen.add(value);
    });
}

/** 按固定字段顺序和 resolution key 顺序产生 fields。 */
function sortFields<TField extends string>(fields: Record<TField, string[]>, order: readonly TField[]): Record<TField, string[]> {
    const result = {} as Record<TField, string[]>;
    for (const field of order) {
        result[field] = [...fields[field]].sort(compareText);
    }
    return result;
}

/** 按固定字段顺序产生仅含已使用字段的 syntax refs。 */
function sortFieldRefs<TField extends string>(
    refs: Partial<Record<TField, string[]>>,
    order: readonly TField[],
): Partial<Record<TField, string[]>> {
    const result: Partial<Record<TField, string[]>> = {};
    for (const field of order) {
        const fieldRefs = refs[field];
        if (fieldRefs && fieldRefs.length > 0) {
            result[field] = [...fieldRefs].sort(compareText);
        }
    }
    return result;
}

/** 按 key 规范普通 typed map。 */
function sortMap<TValue>(input: Record<string, TValue>): Record<string, TValue> {
    return Object.fromEntries(Object.entries(input).sort(([left], [right]) => compareText(left, right)));
}

/** 规范 Provider syntax map 与节点内部 resolution key 顺序。 */
function sortSyntaxNodes(input: Record<string, ProviderSyntaxNode>): Record<string, ProviderSyntaxNode> {
    return sortMap(Object.fromEntries(Object.entries(input).map(([key, node]) => [
        key,
        {...node, resolutionKeys: [...node.resolutionKeys].sort(compareText)},
    ])));
}

/** 使用明确 locale-independent code point 顺序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
