import {hashTextToImageContract} from "nbook/shared/text-to-image-contract-hash";
import {
    createStoryboardPresetHashes,
    resolveStoryboardOverlayReviewState,
    resolveStoryboardReviewState,
    StoryboardOverlaySchema,
    StoryboardPresetSchema,
    type StoryboardOverlay,
    type StoryboardPreset,
    type StoryboardRule,
} from "nbook/shared/text-to-image-storyboard-preset";

export type StoryboardRuleProvenance = {
    ruleId: string;
    scope: "base" | "project";
    operation: "base" | "replace" | "disable" | "append";
    sourceEntryId: string | null;
};

export type StoryboardRuleResolution = {
    status: "applied" | "skipped_stale" | "rejected_conflict";
    blocked: boolean;
    effectiveRules: StoryboardRule[];
    provenance: StoryboardRuleProvenance[];
    effectivePresetHash: string;
    diagnostics: Array<{code: "STORYBOARD_OVERLAY_CONFLICT" | "STORYBOARD_PRESET_STALE"; message: string}>;
};

/**
 * 以整份事务语义应用 Project Storyboard overlay。
 *
 * 任一 stale/conflict 都返回未修改的 approved base；strictOverlay 只改变调用方是否阻断，不改变事实结果。
 */
export function resolveStoryboardRules(input: {
    base: StoryboardPreset;
    overlay: StoryboardOverlay;
    strictOverlay?: boolean;
}): StoryboardRuleResolution {
    const base = StoryboardPresetSchema.parse(input.base);
    const overlay = StoryboardOverlaySchema.parse(input.overlay);
    if (!base.enabled || resolveStoryboardReviewState(base) !== "approved") {
        throw new Error("STORYBOARD_PRESET_STALE: 全局 Storyboard Preset 未获批准或已漂移");
    }
    const baseHashes = createStoryboardPresetHashes(base);
    if (!overlay.enabled
        || overlay.presetId !== base.presetId
        || overlay.baseSemanticHash !== baseHashes.semanticHash
        || resolveStoryboardOverlayReviewState(overlay) !== "approved") {
        return fallback(base, "skipped_stale", Boolean(input.strictOverlay), {
            code: "STORYBOARD_PRESET_STALE",
            message: "Project Storyboard overlay 未批准、身份不匹配或 baseSemanticHash 已漂移",
        });
    }

    const rulesById = new Map(base.rules.map((rule) => [rule.ruleId, rule]));
    const provenanceById = new Map(base.rules.map((rule) => [rule.ruleId, createProvenance(rule, "base", "base")]));
    for (const operation of overlay.operations) {
        const current = rulesById.get(operation.ruleId);
        if (operation.op === "append") {
            if (current) {
                return fallback(base, "rejected_conflict", Boolean(input.strictOverlay), {
                    code: "STORYBOARD_OVERLAY_CONFLICT",
                    message: `append ruleId 已存在：${operation.ruleId}`,
                });
            }
            rulesById.set(operation.ruleId, operation.rule);
            provenanceById.set(operation.ruleId, createProvenance(operation.rule, "project", "append"));
            continue;
        }
        if (!current) {
            return fallback(base, "rejected_conflict", Boolean(input.strictOverlay), {
                code: "STORYBOARD_OVERLAY_CONFLICT",
                message: `${operation.op} 目标不存在：${operation.ruleId}`,
            });
        }
        if (operation.op === "replace") {
            rulesById.set(operation.ruleId, operation.rule);
            provenanceById.set(operation.ruleId, createProvenance(operation.rule, "project", "replace"));
        } else {
            const disabled = {...current, enabled: false} as StoryboardRule;
            rulesById.set(operation.ruleId, disabled);
            provenanceById.set(operation.ruleId, createProvenance(disabled, "project", "disable"));
        }
    }

    const effectiveRules = sortRules([...rulesById.values()]);
    return {
        status: "applied",
        blocked: false,
        effectiveRules,
        provenance: effectiveRules.map((rule) => provenanceById.get(rule.ruleId)!),
        effectivePresetHash: createEffectiveHash(base, effectiveRules, {...base.macros.bindings, ...overlay.macroBindings}),
        diagnostics: [],
    };
}

function fallback(
    base: StoryboardPreset,
    status: "skipped_stale" | "rejected_conflict",
    blocked: boolean,
    diagnostic: StoryboardRuleResolution["diagnostics"][number],
): StoryboardRuleResolution {
    const effectiveRules = sortRules([...base.rules]);
    return {
        status,
        blocked,
        effectiveRules,
        provenance: effectiveRules.map((rule) => createProvenance(rule, "base", "base")),
        effectivePresetHash: createEffectiveHash(base, effectiveRules, base.macros.bindings),
        diagnostics: [diagnostic],
    };
}

function createEffectiveHash(
    base: StoryboardPreset,
    rules: StoryboardRule[],
    macroBindings: StoryboardPreset["macros"]["bindings"],
): string {
    return hashTextToImageContract({
        schema: base.schema,
        presetId: base.presetId,
        enabled: base.enabled,
        matching: base.matching,
        defaults: base.defaults,
        macroBindings,
        rules: rules.map(({provenance: _provenance, ...rule}) => rule),
    });
}

function createProvenance(
    rule: StoryboardRule,
    scope: StoryboardRuleProvenance["scope"],
    operation: StoryboardRuleProvenance["operation"],
): StoryboardRuleProvenance {
    return {ruleId: rule.ruleId, scope, operation, sourceEntryId: rule.sourceEntryId ?? null};
}

function sortRules(rules: StoryboardRule[]): StoryboardRule[] {
    return rules.sort((left, right) => left.order - right.order || left.ruleId.localeCompare(right.ruleId));
}
