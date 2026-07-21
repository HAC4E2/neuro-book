import {describe, expect, it} from "vitest";
import {createIllustrationExecutionManifestHash} from "nbook/shared/text-to-image-execution";
import {
    ILLUSTRATION_DISPATCH_REGISTRATION_VERSION,
    prepareIllustrationExecutionRegistration,
} from "nbook/server/text-to-image/execution.repository";
import {
    illustrationRegistrationFixture,
    TEST_CONTRACT_HASH,
} from "nbook/server/text-to-image/execution.test-fixtures";

describe("illustration registration projection", () => {
    it("is the only stable job/dispatch identity projection for App and Project", () => {
        const firstInput = illustrationRegistrationFixture(2);
        const first = prepareIllustrationExecutionRegistration(firstInput);
        const replayInputHashes = [TEST_CONTRACT_HASH("8"), TEST_CONTRACT_HASH("9")];
        const recipeSnapshot = firstInput.compiledRequests[0]?.recipeSnapshot;
        if (!recipeSnapshot) throw new Error("测试 fixture 缺少 Recipe snapshot");
        const replayManifestHash = createIllustrationExecutionManifestHash({
            executionInputHashes: replayInputHashes,
            recipeSnapshot,
            compiledRequests: firstInput.compiledRequests,
            outputCount: firstInput.outputCount,
            knownCost: firstInput.knownCost,
            tokenLowerBound: firstInput.tokenLowerBound,
        });
        const replay = prepareIllustrationExecutionRegistration({
            ...firstInput,
            executionNonce: "nonce-2",
            executionInputHashes: replayInputHashes,
            executionManifestHash: replayManifestHash,
        });

        expect(ILLUSTRATION_DISPATCH_REGISTRATION_VERSION).toBe("route-b-dispatch-registration-v2");
        expect(replay.jobs.map((job) => job.id)).toEqual(first.jobs.map((job) => job.id));
        expect(replay.jobs.map((job) => job.dispatchKey)).toEqual(first.jobs.map((job) => job.dispatchKey));
        expect(replay.preparationId).toBe(first.preparationId);
    });
});
