import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {saveTextToImageReferenceImage} from "nbook/server/text-to-image/reference-image.service";
import {createTextToImageReferenceResolver} from "nbook/server/text-to-image/reference-resolver";

const PROJECT_NAME = "demo-project";

let workspaceRoot: string;
let projectRoot: string;

beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-reference-resolver-"));
    projectRoot = path.join(workspaceRoot, PROJECT_NAME);
    await mkdir(path.join(projectRoot, "assets", "tti-masks"), {recursive: true});
    await mkdir(path.join(projectRoot, "assets", "tti"), {recursive: true});
    setWorkspaceRuntimeRootContextForTest({workspaceRoot});
});

afterEach(async () => {
    setWorkspaceRuntimeRootContextForTest(null);
    await rm(workspaceRoot, {recursive: true, force: true});
});

describe("createTextToImageReferenceResolver", () => {
    it("reads global reference images by relative path", async () => {
        const bytes = new TextEncoder().encode("reference-image-bytes");
        const meta = await saveTextToImageReferenceImage({
            fileName: "ref.png",
            bytes,
        });

        const resolver = createTextToImageReferenceResolver(PROJECT_NAME);

        await expect(resolver.readReference(meta.relativePath)).resolves.toEqual(bytes);
    });

    it("reads project mask bytes by relative path", async () => {
        const bytes = new TextEncoder().encode("mask-png-bytes");
        const relativePath = "assets/tti-masks/mask-1.png";
        await writeFile(path.join(projectRoot, relativePath), Buffer.from(bytes));

        const resolver = createTextToImageReferenceResolver(PROJECT_NAME);

        await expect(resolver.readReference(relativePath)).resolves.toEqual(bytes);
    });

    it("reads project asset bytes by relative path", async () => {
        const bytes = new TextEncoder().encode("asset-png-bytes");
        const relativePath = "assets/tti/asset-1.png";
        await writeFile(path.join(projectRoot, relativePath), Buffer.from(bytes));

        const resolver = createTextToImageReferenceResolver(PROJECT_NAME);

        await expect(resolver.readReference(relativePath)).resolves.toEqual(bytes);
    });
});
