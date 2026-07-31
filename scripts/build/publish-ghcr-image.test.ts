import {describe, expect, it} from "vitest";

import {buildArgs, normalizeSourceRevision} from "nbook/scripts/deploy/publish-ghcr-image.mjs";

describe("GHCR发布Source revision合同", () => {
    it("app build把规范化revision传给Product Runtime Image Builder", () => {
        const revision = "A".repeat(40);

        expect(buildArgs({
            image: "ghcr.io/notnotype/neuro-book",
            platform: "linux/amd64",
            tags: ["v1.0.0"],
            sourceRevision: revision,
        })).toEqual([
            "buildx",
            "build",
            "--platform",
            "linux/amd64",
            "--push",
            "--build-arg",
            `NEURO_BOOK_SOURCE_REVISION=${revision.toLowerCase()}`,
            "-t",
            "ghcr.io/notnotype/neuro-book:v1.0.0",
            ".",
        ]);
    });

    it("拒绝把非Git object ID伪装成Source revision", () => {
        expect(() => normalizeSourceRevision("main")).toThrow("Source revision无效");
    });
});
