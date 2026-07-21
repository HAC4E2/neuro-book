import {z} from "zod";
import {
    ProjectTagPolicyConfigSchema,
    TagPolicyRegistrySchema,
    type ProjectTagPolicyConfig,
    type TagPolicyDecision,
    type TagPolicyDecisionEvidence,
    type TagPolicyRegistry,
} from "nbook/shared/text-to-image-tag-policy";
import {TagIndexError} from "nbook/server/text-to-image/tag-index/tag-index-error";

const CanonicalTagNameSchema = z.string().regex(/^[\x21-\x2b\x2d-\x7e]{1,170}$/u);

/**
 * 返回应用内置的最小版本化 policy。
 *
 * `rating:*` 属于控制语法而不是可执行 canonical Tag，始终 block；明显成人内容只在 general scope 要求人工复核。
 */
export function createBuiltinTagPolicyRegistry(): TagPolicyRegistry {
    const reviewTags = ["explicit", "guro", "nude", "questionable", "sex", "sensitive"];
    return TagPolicyRegistrySchema.parse({
        schemaVersion: "nbook.tag-policy-registry/v1",
        policyVersion: "nbook-minimum-policy-2026-07-1",
        provenance: {
            kind: "builtin",
            sourceId: "nbook-minimum-safety-2026-07",
            reviewedAt: "2026-07-20T00:00:00.000Z",
        },
        rules: [
            {
                ruleId: "block-rating-control-prefix",
                selector: {kind: "pattern", match: "prefix", value: "rating:"},
                contentScopes: ["general", "all"],
                decision: "block",
                provenance: {
                    sourceId: "nbook-provider-grammar-boundary",
                    rationale: "rating:* 是控制语法，不允许伪装成 canonical Tag",
                },
            },
            ...reviewTags.map((canonicalName) => ({
                ruleId: `review-general-${canonicalName}`,
                selector: {kind: "canonical" as const, canonicalName},
                contentScopes: ["general" as const],
                decision: "review_required" as const,
                provenance: {
                    sourceId: "nbook-minimum-safety-2026-07",
                    rationale: "general scope 下需要用户逐项确认的成人内容标签",
                },
            })),
        ],
    });
}

/** 只读 Tag policy evaluator；没有 Project rule mutation 接口。 */
export class TagPolicyRegistryService {
    readonly registry: TagPolicyRegistry;

    constructor(options: {registry?: TagPolicyRegistry} = {}) {
        this.registry = TagPolicyRegistrySchema.parse(options.registry ?? createBuiltinTagPolicyRegistry());
    }

    /** 对 official canonical Tag 计算 block > review > allow 的确定性 evidence。 */
    decideCanonical(canonicalNameInput: string, projectInput: ProjectTagPolicyConfig): TagPolicyDecisionEvidence {
        const canonicalName = assertPolicyCanonicalName(canonicalNameInput);
        const project = ProjectTagPolicyConfigSchema.parse(projectInput);
        const matched = this.registry.rules
            .filter((rule) => rule.contentScopes.includes(project.contentScope) && selectorMatches(rule.selector, canonicalName))
            .sort((left, right) => compareText(left.ruleId, right.ruleId));
        return {
            policyVersion: this.registry.policyVersion,
            contentScope: project.contentScope,
            decision: strongestDecision(matched.map((rule) => rule.decision)),
            matchedRuleIds: matched.map((rule) => rule.ruleId),
        };
    }

    /** 库外普通文本只服从 Project unknown policy，不产生伪造 registry rule。 */
    decideUnknown(projectInput: ProjectTagPolicyConfig): TagPolicyDecisionEvidence {
        const project = ProjectTagPolicyConfigSchema.parse(projectInput);
        return {
            policyVersion: this.registry.policyVersion,
            contentScope: project.contentScope,
            decision: project.unknownTagPolicy === "provider_passthrough" ? "allow" : "review_required",
            matchedRuleIds: [],
        };
    }

    /** Agent suggestion/自动补全仅暴露 allow；review/block 仍可在显式导入 diff 中单独显示。 */
    filterAutomatic<TRecord extends {canonicalName: string}>(
        records: readonly TRecord[],
        projectInput: ProjectTagPolicyConfig,
    ): Array<{record: TRecord; evidence: TagPolicyDecisionEvidence}> {
        return records.flatMap((record) => {
            const evidence = this.decideCanonical(record.canonicalName, projectInput);
            return evidence.decision === "allow" ? [{record, evidence}] : [];
        });
    }
}

/** selector 的 fixed canonical/prefix/suffix/contains 语义。 */
function selectorMatches(
    selector: TagPolicyRegistry["rules"][number]["selector"],
    canonicalName: string,
): boolean {
    if (selector.kind === "canonical") return selector.canonicalName === canonicalName;
    if (selector.match === "prefix") return canonicalName.startsWith(selector.value);
    if (selector.match === "suffix") return canonicalName.endsWith(selector.value);
    return canonicalName.includes(selector.value);
}

/** 决策优先级固定为 block > review_required > allow。 */
function strongestDecision(decisions: TagPolicyDecision[]): TagPolicyDecision {
    if (decisions.includes("block")) return "block";
    if (decisions.includes("review_required")) return "review_required";
    return "allow";
}

/** 不依赖 locale 的稳定 ASCII 排序。 */
function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

/** 对调用方误传非 canonical 值保留稳定领域错误。 */
export function assertPolicyCanonicalName(value: string): string {
    const parsed = CanonicalTagNameSchema.safeParse(value);
    if (!parsed.success) {
        throw new TagIndexError({code: "TAG_RESOLUTION_INVALID", message: "Tag policy canonical name 非法"});
    }
    return parsed.data;
}
