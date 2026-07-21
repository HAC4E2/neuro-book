import {describe, expect, it} from "vitest";
import {TagPolicyRegistrySchema} from "nbook/shared/text-to-image-tag-policy";
import {
    createBuiltinTagPolicyRegistry,
    TagPolicyRegistryService,
} from "nbook/server/text-to-image/tag-index/tag-policy-registry";

const GENERAL = {contentScope: "general", unknownTagPolicy: "provider_passthrough"} as const;
const ALL = {contentScope: "all", unknownTagPolicy: "provider_passthrough"} as const;

describe("TagPolicyRegistryService", () => {
    it("keeps block global, requires review only in general scope, and exposes only allow automatically", () => {
        const service = new TagPolicyRegistryService({registry: createBuiltinTagPolicyRegistry()});

        expect(service.decideCanonical("rating:explicit", GENERAL).decision).toBe("block");
        expect(service.decideCanonical("rating:explicit", ALL).decision).toBe("block");
        expect(service.decideCanonical("nude", GENERAL).decision).toBe("review_required");
        expect(service.decideCanonical("nude", ALL).decision).toBe("allow");
        expect(service.decideCanonical("wide_shot", GENERAL).decision).toBe("allow");
        expect(service.filterAutomatic([
            {canonicalName: "wide_shot", tagId: 1},
            {canonicalName: "nude", tagId: 2},
            {canonicalName: "rating:explicit", tagId: 3},
        ], GENERAL)).toEqual([
            {record: {canonicalName: "wide_shot", tagId: 1}, evidence: expect.objectContaining({decision: "allow"})},
        ]);
    });

    it("maps unknown text only through the Project unknown policy", () => {
        const service = new TagPolicyRegistryService({registry: createBuiltinTagPolicyRegistry()});

        expect(service.decideUnknown(GENERAL)).toMatchObject({decision: "allow", matchedRuleIds: []});
        expect(service.decideUnknown({...GENERAL, unknownTagPolicy: "review_required"})).toMatchObject({
            decision: "review_required",
            matchedRuleIds: [],
        });
    });

    it("uses deterministic block > review > allow priority for overlapping builtin evidence", () => {
        const registry = TagPolicyRegistrySchema.parse({
            schemaVersion: "nbook.tag-policy-registry/v1",
            policyVersion: "policy-overlap-v1",
            provenance: {kind: "builtin", sourceId: "fixture-policy", reviewedAt: "2026-07-20T00:00:00.000Z"},
            rules: [
                {ruleId: "allow-prefix", selector: {kind: "pattern", match: "prefix", value: "unsafe_"}, contentScopes: ["general"], decision: "allow", provenance: {sourceId: "fixture-policy", rationale: "fixture allow"}},
                {ruleId: "review-suffix", selector: {kind: "pattern", match: "suffix", value: "token"}, contentScopes: ["general"], decision: "review_required", provenance: {sourceId: "fixture-policy", rationale: "fixture review"}},
                {ruleId: "block-exact", selector: {kind: "canonical", canonicalName: "unsafe_token"}, contentScopes: ["general"], decision: "block", provenance: {sourceId: "fixture-policy", rationale: "fixture block"}},
            ],
        });
        const evidence = new TagPolicyRegistryService({registry}).decideCanonical("unsafe_token", GENERAL);

        expect(evidence.decision).toBe("block");
        expect(evidence.matchedRuleIds).toEqual(["allow-prefix", "block-exact", "review-suffix"]);
    });
});
