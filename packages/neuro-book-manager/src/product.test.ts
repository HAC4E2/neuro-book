import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {buildTestRuntimeImage, TEST_RUNTIME_IMAGE_PLATFORM} from "#manager/fixtures/runtime-image";
import {verifyProductRuntimeControlPlane, verifyProductRuntimeImage} from "#manager/product";

const roots: string[] = [];
const REVISION = "b".repeat(40);

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Manager Product Runtime Image control plane", () => {
    it("接受 manifest、ready marker 和关键 bundle command 一致的镜像", async () => {
        const fixture = await runtimeImageFixture();

        await expect(verifyProductRuntimeImage(fixture.root, fixture.identity)).resolves.toEqual(fixture.identity);
        await expect(verifyProductRuntimeControlPlane(fixture.root, fixture.identity)).resolves.toEqual(fixture.identity);
    });

    it("拒绝缺少 ready marker、错误代次和 payload 篡改", async () => {
        const missingReady = await runtimeImageFixture();
        await rm(join(missingReady.root, "runtime-image.ready"));
        await expect(verifyProductRuntimeImage(missingReady.root, missingReady.identity)).rejects.toMatchObject({code: "ENOENT"});

        const mismatch = await runtimeImageFixture();
        await expect(verifyProductRuntimeImage(mismatch.root, {...mismatch.identity, revision: "c".repeat(40)}))
            .rejects.toThrow("revision");

        const tampered = await runtimeImageFixture();
        await writeFile(join(tampered.root, "server", "index.mjs"), "export const tampered = true;\n", "utf8");
        await expect(verifyProductRuntimeControlPlane(tampered.root, tampered.identity)).resolves.toEqual(tampered.identity);
        await expect(verifyProductRuntimeImage(tampered.root, tampered.identity))
            .rejects.toThrow("payload digest 不一致");
    });
});

/** 创建 Manager 控制面所需的最小 verified-image fixture。 */
async function runtimeImageFixture() {
    const sourceRoot = await mkdtemp(join(tmpdir(), "nbook-manager-runtime-image-"));
    roots.push(sourceRoot);
    const platform = TEST_RUNTIME_IMAGE_PLATFORM;
    const image = await buildTestRuntimeImage({sourceRoot, version: "0.8.0", revision: REVISION, platform});
    const identity = {
        version: image.manifest.version,
        revision: image.manifest.revision,
        dirty: image.manifest.dirty,
        platform: image.manifest.platform,
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        lockfileSha256: image.manifest.lockfileSha256,
        builderContractVersion: image.manifest.builderContractVersion,
    };
    return {root: image.path, identity};
}
