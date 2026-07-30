import {
    resolveTagPatternReviewState,
    TagPatternSetSchema,
    type TagPatternSet,
} from "nbook/shared/text-to-image-tag-pattern";
import {
    resolveStoryboardReviewState,
    StoryboardPresetSchema,
    type StoryboardPreset,
} from "nbook/shared/text-to-image-storyboard-preset";

/** 确认 selector 指向同一份已启用、已批准且身份一致的 Storyboard/Pattern companion。 */
export function assertStoryboardPatternPair(input: {
    preset: StoryboardPreset;
    patternSet: TagPatternSet | null;
}): {presetId: string; packageId: string; resourceKey: string} {
    const preset = StoryboardPresetSchema.parse(input.preset);
    if (!preset.enabled || resolveStoryboardReviewState(preset) !== "approved") {
        throw new Error("STORYBOARD_PRESET_STALE: Storyboard Preset 未获批准或已漂移");
    }
    if (!input.patternSet) {
        throw new Error("TAG_PATTERN_SET_STALE: Storyboard companion 缺失");
    }
    const patternSet = TagPatternSetSchema.parse(input.patternSet);
    if (!patternSet.enabled || resolveTagPatternReviewState(patternSet) !== "approved") {
        throw new Error("TAG_PATTERN_SET_STALE: Tag Pattern Set 未获批准或已漂移");
    }
    if (preset.presetId !== patternSet.presetId
        || preset.patternSetId !== patternSet.patternSetId
        || preset.packageId !== patternSet.packageId
        || preset.resourceKey !== patternSet.resourceKey) {
        throw new Error("TAG_PATTERN_SET_STALE: Storyboard/Pattern companion identity 不一致");
    }
    return {presetId: preset.presetId, packageId: preset.packageId, resourceKey: preset.resourceKey};
}
