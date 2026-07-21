import {describe, expect, it} from "vitest";
import {
    createTagPolicyApprovalHash,
    createDefaultProjectTagPolicyConfig,
    ProjectTagPolicyConfigSchema,
    TagPolicyApprovalSchema,
    TagPolicyRegistrySchema,
} from "nbook/shared/text-to-image-tag-policy";

describe("text-to-image Tag policy contracts", () => {
    it("defaults unknown ordinary text to controlled provider passthrough", () => {
        expect(createDefaultProjectTagPolicyConfig()).toEqual({
            contentScope: "general",
            unknownTagPolicy: "provider_passthrough",
        });
    });

    it("allows a strict Project to require review without adding custom rules", () => {
        expect(ProjectTagPolicyConfigSchema.parse({
            contentScope: "general",
            unknownTagPolicy: "review_required",
        }).unknownTagPolicy).toBe("review_required");
        expect(() => ProjectTagPolicyConfigSchema.parse({
            contentScope: "general",
            unknownTagPolicy: "block",
        })).toThrow();
        expect(() => ProjectTagPolicyConfigSchema.parse({
            contentScope: "general",
            unknownTagPolicy: "provider_passthrough",
            rules: [],
        })).toThrow();
    });

    it("keeps versioned builtin policy separate from official facts", () => {
        const registry = TagPolicyRegistrySchema.parse({
            schemaVersion: "nbook.tag-policy-registry/v1",
            policyVersion: "safe-v1",
            provenance: {
                kind: "builtin",
                sourceId: "nbook-minimum-safety-v1",
                reviewedAt: "2026-07-20T00:00:00.000Z",
            },
            rules: [
                {
                    ruleId: "block-control-token",
                    selector: {kind: "canonical", canonicalName: "unsafe_control_token"},
                    contentScopes: ["general", "all"],
                    decision: "block",
                    provenance: {sourceId: "nbook-minimum-safety-v1", rationale: "禁止控制语法"},
                },
                {
                    ruleId: "review-sensitive-prefix",
                    selector: {kind: "pattern", match: "prefix", value: "sensitive_"},
                    contentScopes: ["general"],
                    decision: "review_required",
                    provenance: {sourceId: "nbook-minimum-safety-v1", rationale: "general scope 需人工复核"},
                },
            ],
        });
        expect(registry.rules).toHaveLength(2);
        expect(() => TagPolicyRegistrySchema.parse({
            ...registry,
            rules: [...registry.rules, {...registry.rules[0], decision: "allow"}],
        })).toThrow(/ruleId/u);
        expect(() => TagPolicyRegistrySchema.parse({...registry, danbooruTags: []})).toThrow();
    });

    it("人工 review approval 严格绑定 owner、resolution、来源与 policy subject", () => {
        const approval = TagPolicyApprovalSchema.parse({
            schemaVersion: "nbook.tag-policy-approval/v1",
            approvalId: "approval.import.1",
            actorId: "user-1",
            reason: "确认该标签适用于当前导入 Pattern",
            policyVersion: "safe-v1",
            contentScope: "general",
            matchedRuleIds: ["review-general-explicit"],
            resolutionKey: "tag.abc123",
            ownerIdentity: "cinematic-chapter/pattern.rain",
            ownerSlot: "pattern:scene",
            sourcePath: "/entries/1/content",
            sourceTextHash: `sha256:${"a".repeat(64)}`,
            subject: {kind: "canonical", tagId: 42, canonicalName: "explicit"},
            approvedAt: "2026-07-20T00:00:00.000Z",
        });

        expect(createTagPolicyApprovalHash(approval)).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(createTagPolicyApprovalHash({...approval, approvedAt: "2026-07-20T01:00:00.000Z"})).toBe(
            createTagPolicyApprovalHash(approval),
        );
        expect(() => TagPolicyApprovalSchema.parse({...approval, decision: "allow"})).toThrow();
        expect(() => TagPolicyApprovalSchema.parse({...approval, providerId: "forbidden"})).toThrow();
    });
});
