import {
    createTagPatternSetHashes,
    listEnabledTagPatterns,
    resolveTagPatternOverlayReviewState,
    resolveTagPatternReviewState,
    TagPatternOverlaySchema,
    TagPatternSetSchema,
    type TagPattern,
    type TagPatternOverlay,
    type TagPatternSet,
} from "nbook/shared/text-to-image-tag-pattern";
export {assertStoryboardPatternPair} from "nbook/server/text-to-image/storyboard-companion";

export type TagPatternResolution = {
    status: "applied" | "skipped_stale" | "rejected_conflict";
    blocked: boolean;
    effectivePatterns: TagPattern[];
    candidates: TagPattern[];
    provenance: TagPatternProvenance[];
    effectivePlanningHash: string;
    effectiveRenderHash: string;
    diagnostics: Array<{code: "TAG_PATTERN_SET_STALE" | "TAG_PATTERN_OVERLAY_CONFLICT"; message: string}>;
};

export type TagPatternProvenance = {
    patternId: string;
    scope: "base" | "project";
    operation: "base" | "replace" | "disable" | "append";
    /** Pattern 没有来源 entry 时为 null。 */
    sourceEntryId: string | null;
};

/** 以整份事务语义应用 Project Tag Pattern overlay。 */
export function resolveTagPatterns(input: {
    base: TagPatternSet;
    overlay: TagPatternOverlay;
    strictOverlay?: boolean;
}): TagPatternResolution {
    const base = TagPatternSetSchema.parse(input.base);
    const overlay = TagPatternOverlaySchema.parse(input.overlay);
    if (!base.enabled || resolveTagPatternReviewState(base) !== "approved") {
        throw new Error("TAG_PATTERN_SET_STALE: 全局 Tag Pattern Set 未获批准或已漂移");
    }
    const baseHashes = createTagPatternSetHashes(base);
    if (!overlay.enabled
        || overlay.patternSetId !== base.patternSetId
        || overlay.basePlanningHash !== baseHashes.planningHash
        || overlay.baseRenderHash !== baseHashes.renderHash
        || resolveTagPatternOverlayReviewState(overlay) !== "approved") {
        return patternFallback(base, "skipped_stale", Boolean(input.strictOverlay), {
            code: "TAG_PATTERN_SET_STALE",
            message: "Project Pattern overlay 未批准、身份不匹配或 base hash 已漂移",
        });
    }

    const patternsById = new Map(base.patterns.map((pattern) => [pattern.patternId, pattern]));
    const provenanceById = new Map(base.patterns.map((pattern) => [
        pattern.patternId,
        createPatternProvenance(pattern, "base", "base"),
    ]));
    for (const operation of overlay.operations) {
        const current = patternsById.get(operation.patternId);
        if (operation.op === "append") {
            if (current) {
                return patternFallback(base, "rejected_conflict", Boolean(input.strictOverlay), {
                    code: "TAG_PATTERN_OVERLAY_CONFLICT",
                    message: `append patternId 已存在：${operation.patternId}`,
                });
            }
            patternsById.set(operation.patternId, operation.pattern);
            provenanceById.set(operation.patternId, createPatternProvenance(operation.pattern, "project", "append"));
            continue;
        }
        if (!current) {
            return patternFallback(base, "rejected_conflict", Boolean(input.strictOverlay), {
                code: "TAG_PATTERN_OVERLAY_CONFLICT",
                message: `${operation.op} 目标不存在：${operation.patternId}`,
            });
        }
        const effectivePattern = operation.op === "replace" ? operation.pattern : {...current, enabled: false};
        patternsById.set(operation.patternId, effectivePattern);
        provenanceById.set(
            operation.patternId,
            createPatternProvenance(effectivePattern, "project", operation.op),
        );
    }
    return createPatternResult(base, [...patternsById.values()], provenanceById, "applied", false, []);
}

function patternFallback(
    base: TagPatternSet,
    status: "skipped_stale" | "rejected_conflict",
    blocked: boolean,
    diagnostic: TagPatternResolution["diagnostics"][number],
): TagPatternResolution {
    return createPatternResult(
        base,
        base.patterns,
        new Map(base.patterns.map((pattern) => [pattern.patternId, createPatternProvenance(pattern, "base", "base")])),
        status,
        blocked,
        [diagnostic],
    );
}

function createPatternResult(
    base: TagPatternSet,
    patterns: TagPattern[],
    provenanceById: Map<string, TagPatternProvenance>,
    status: TagPatternResolution["status"],
    blocked: boolean,
    diagnostics: TagPatternResolution["diagnostics"],
): TagPatternResolution {
    const effectivePatterns = patterns.sort((left, right) => left.order - right.order || left.patternId.localeCompare(right.patternId));
    const effectiveSet = TagPatternSetSchema.parse({...base, patterns: effectivePatterns});
    const hashes = createTagPatternSetHashes(effectiveSet);
    return {
        status,
        blocked,
        effectivePatterns,
        candidates: listEnabledTagPatterns(effectiveSet),
        provenance: effectivePatterns.map((pattern) => provenanceById.get(pattern.patternId)!),
        effectivePlanningHash: hashes.planningHash,
        effectiveRenderHash: hashes.renderHash,
        diagnostics,
    };
}

function createPatternProvenance(
    pattern: TagPattern,
    scope: TagPatternProvenance["scope"],
    operation: TagPatternProvenance["operation"],
): TagPatternProvenance {
    return {patternId: pattern.patternId, scope, operation, sourceEntryId: pattern.sourceEntryId ?? null};
}
