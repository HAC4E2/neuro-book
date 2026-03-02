import {describe, expect, it} from "vitest";
import {RetrievalInputSchema, RetrievalOutputSchema} from "nbook/server/agent/profiles/builtin/retrieval.contract";
import {RetrievalProfile} from "nbook/server/agent/profiles/builtin/retrieval.profile";

describe("RetrievalProfile", () => {
    it("在 profile 实例上显式暴露输入和输出 schema", () => {
        const profile = new RetrievalProfile();

        expect(profile.inputSchema).toBe(RetrievalInputSchema);
        expect(profile.outputSchema).toBe(RetrievalOutputSchema);
    });
});
