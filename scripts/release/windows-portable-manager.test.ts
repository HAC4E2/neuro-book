import {createHash} from "node:crypto";
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {relative, resolve} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {strToU8, zipSync} from "fflate";

import {ProductRuntimeImageBuilder} from "nbook/scripts/build/product-runtime-image-builder";
import {materializePortableArchives, portableArchiveComponents} from "nbook/scripts/deploy/windows-portable-manager";
import {releaseBuildId as computeReleaseBuildId} from "nbook/scripts/release/release-output";
import {writeZipArchive, type ZipEntry} from "nbook/scripts/utils/zip";
import {
    createProductRuntimeContract,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_RUNTIME_CONTRACT_PATH,
} from "nbook/shared/product-runtime-contract";

const VERSION = "1.2.3-canary.1";
const REVISION = "a".repeat(40);
const PAYLOAD_PATH = "server/index.mjs";
const COMMAND_PATH = "server/commands/all.mjs";
const LOCKFILE = "lockfileVersion = 1\n";

const cleanupRoots: string[] = [];

afterEach(async () => {
    await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Windows Portable archive provenance", () => {
    it("工作树与归档内容不同时只组装传入的 Source/Product archives", async () => {
        const root = await temporaryRoot();
        const liveRoot = resolve(root, "live-worktree");
        const archiveRoot = resolve(root, "archive-input");
        const stage = resolve(root, "portable-stage");
        await mkdir(resolve(liveRoot, ".output", "server"), {recursive: true});
        await writeFile(resolve(liveRoot, "package.json"), JSON.stringify({name: "neuro-book", version: "9.9.9"}), "utf8");
        await writeFile(resolve(liveRoot, "live-only.txt"), "live source", "utf8");
        await writeFile(resolve(liveRoot, ".output", "server", "index.mjs"), "live product", "utf8");

        const archives = await writeValidArchives(archiveRoot);
        await mkdir(stage, {recursive: true});
        const identity = await materializePortableArchives(stage, archives.source, archives.product);

        expect(identity.version).toBe(VERSION);
        expect(identity.revision).toBe(REVISION);
        expect(identity.buildId).toBe(releaseBuildId());
        expect(identity.sourceArchiveSha256).toBe(createHash("sha256").update(await readFile(archives.source)).digest("hex"));
        expect(identity.productArchiveSha256).toBe(createHash("sha256").update(await readFile(archives.product)).digest("hex"));
        expect(identity.runtimeImage.imageId).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(identity.sourceFiles).toEqual(["archive-only.txt", "bun.lock", "package.json", "source-build.json"]);
        expect(await readFile(resolve(stage, "archive-only.txt"), "utf8")).toBe("archive source");
        expect(await readFile(resolve(stage, ".output", "server", "index.mjs"), "utf8")).toBe("export const origin = 'archive product';\n");
        expect(await readdir(stage)).not.toContain("live-only.txt");
        const components = portableArchiveComponents(identity);
        expect(components.source.archiveSha256).toBe(identity.sourceArchiveSha256);
        expect(components.product).toMatchObject({
            archiveSha256: identity.productArchiveSha256,
            version: VERSION,
            revision: REVISION,
            platform: "windows-x64",
            imageId: identity.runtimeImage.imageId,
            sourceDigest: identity.runtimeImage.sourceDigest,
            lockfileSha256: identity.runtimeImage.lockfileSha256,
            builderContractVersion: identity.runtimeImage.builderContractVersion,
        });
        expect((await readdir(root)).some((entry) => entry.startsWith(".portable-archives-"))).toBe(false);
    });

    it("Source archive 的 path traversal 在写入前失败", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const source = resolve(root, "traversal.zip");
        await mkdir(stage, {recursive: true});
        await writeFile(source, zipSync({
            "package.json": strToU8(JSON.stringify({name: "neuro-book", version: VERSION})),
            "bun.lock": strToU8(LOCKFILE),
            "../escape.txt": strToU8("escape"),
        }));

        await expect(materializePortableArchives(stage, source, resolve(root, "unused-product.zip")))
            .rejects.toThrow("非法或不规范路径");
        await expect(readFile(resolve(root, "escape.txt"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
        expect(await readdir(stage)).toEqual([]);
    });

    it("Source archive 的 Unix symlink entry 在写入前失败", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const source = resolve(root, "symlink.zip");
        await mkdir(stage, {recursive: true});
        const archive = zipSync({
            "package.json": strToU8(JSON.stringify({name: "neuro-book", version: VERSION})),
            "bun.lock": strToU8(LOCKFILE),
            "link": strToU8("package.json"),
        });
        markCentralEntryAsSymlink(archive, "link");
        await writeFile(source, archive);

        await expect(materializePortableArchives(stage, source, resolve(root, "unused-product.zip")))
            .rejects.toThrow("不接受 symlink");
        expect(await readdir(stage)).toEqual([]);
    });

    it("Source/Product buildId 不一致时拒绝发布任何 stage 内容", async () => {
        const root = await temporaryRoot();
        const stage = resolve(root, "stage");
        const archives = await writeValidArchives(resolve(root, "archives"), {productBuildRevision: "b".repeat(40)});
        await mkdir(stage, {recursive: true});

        await expect(materializePortableArchives(stage, archives.source, archives.product))
            .rejects.toThrow("build identity 代次不一致");
        expect(await readdir(stage)).toEqual([]);
        expect((await readdir(root)).some((entry) => entry.startsWith(".portable-archives-"))).toBe(false);
    });
});

/** 通过正式 Builder 生成可被完整复核的最小双归档。 */
async function writeValidArchives(
    root: string,
    options: {productBuildRevision?: string} = {},
): Promise<{source: string; product: string}> {
    const sourceRoot = resolve(root, "source");
    await mkdir(sourceRoot, {recursive: true});
    const packagePath = resolve(sourceRoot, "package.json");
    const lockfilePath = resolve(sourceRoot, "bun.lock");
    const markerPath = resolve(sourceRoot, "archive-only.txt");
    const sourceBuildPath = resolve(sourceRoot, "source-build.json");
    await Promise.all([
        mkdir(resolve(sourceRoot, "node_modules", "nuxt"), {recursive: true}),
        mkdir(resolve(sourceRoot, "node_modules", "nitropack"), {recursive: true}),
    ]);
    await writeFile(packagePath, `${JSON.stringify({name: "neuro-book", version: VERSION}, null, 4)}\n`, "utf8");
    await writeFile(lockfilePath, LOCKFILE, "utf8");
    await writeFile(markerPath, "archive source", "utf8");
    await Promise.all([
        writeFile(resolve(sourceRoot, "node_modules", "nuxt", "package.json"), `${JSON.stringify({
            name: "nuxt",
            version: "4.3.1",
        })}\n`, "utf8"),
        writeFile(resolve(sourceRoot, "node_modules", "nitropack", "package.json"), `${JSON.stringify({
            name: "nitropack",
            version: "2.13.4",
        })}\n`, "utf8"),
    ]);
    await writeFile(sourceBuildPath, `${JSON.stringify({
        schema: "nbook.release-build/v1",
        kind: "source",
        buildId: releaseBuildId(),
        version: VERSION,
        revision: REVISION,
        dirty: false,
        lockfileSha256: sha256Identity(LOCKFILE),
    }, null, 4)}\n`, "utf8");

    const payloadText = "export const origin = 'archive product';\n";
    const image = await new ProductRuntimeImageBuilder(sourceRoot).buildCandidate({
        operationId: "portable-archive-fixture",
        platform: "windows-x64",
        expectedSource: {version: VERSION, revision: REVISION, dirty: false},
        owners: [{name: "server", paths: ["server"]}],
        budget: {
            maxFiles: 16,
            maxBytes: 64 * 1024,
            ownerBaselines: [{name: "server", files: 16, bytes: 64 * 1024}],
        },
        async build({imageRoot}) {
            const contract = createProductRuntimeContract({
                productStart: COMMAND_PATH,
                sqliteMigrate: COMMAND_PATH,
                applicationStateMigration: COMMAND_PATH,
                createAdmin: COMMAND_PATH,
                profile: COMMAND_PATH,
                variable: COMMAND_PATH,
                workspace: COMMAND_PATH,
                prepareSystemAssets: COMMAND_PATH,
                checkMigrations: COMMAND_PATH,
                profileAuthoringSmoke: COMMAND_PATH,
                imageVariantSmoke: COMMAND_PATH,
                sqliteVecSmoke: COMMAND_PATH,
            });
            await mkdir(resolve(imageRoot, "server", "commands"), {recursive: true});
            await Promise.all([
                writeFile(resolve(imageRoot, PAYLOAD_PATH), payloadText, "utf8"),
                writeFile(resolve(imageRoot, COMMAND_PATH), "export {};\n", "utf8"),
                writeFile(resolve(imageRoot, PRODUCT_RUNTIME_COMMAND_BOOTSTRAP), "export {};\n", "utf8"),
                writeFile(
                    resolve(imageRoot, PRODUCT_RUNTIME_CONTRACT_PATH),
                    `${JSON.stringify(contract, null, 2)}\n`,
                    "utf8",
                ),
            ]);
        },
    });
    const productBuildPath = resolve(root, "product", "product-build.json");
    await mkdir(resolve(root, "product"), {recursive: true});
    await writeFile(productBuildPath, `${JSON.stringify({
        schema: "nbook.release-build/v1",
        kind: "product",
        buildId: releaseBuildId(options.productBuildRevision),
        version: VERSION,
        revision: options.productBuildRevision ?? REVISION,
        dirty: false,
        lockfileSha256: sha256Identity(LOCKFILE),
        platform: "windows-x64",
        imageId: image.manifest.imageId,
        sourceDigest: image.manifest.sourceDigest,
        treeDigest: image.manifest.treeDigest,
        builderContractVersion: image.manifest.builderContractVersion,
    }, null, 4)}\n`, "utf8");

    const sourceArchive = resolve(root, "source.zip");
    const productArchive = resolve(root, "product.zip");
    await writeZipArchive(sourceArchive, [
        {kind: "file", source: packagePath, archivePath: "package.json"},
        {kind: "file", source: lockfilePath, archivePath: "bun.lock"},
        {kind: "file", source: markerPath, archivePath: "archive-only.txt"},
        {kind: "file", source: sourceBuildPath, archivePath: "source-build.json"},
    ]);
    await writeZipArchive(productArchive, [
        {kind: "file", source: productBuildPath, archivePath: "product-build.json"},
        ...await runtimeImageZipEntries(image.path),
    ]);
    return {source: sourceArchive, product: productArchive};
}

/** 把 Builder 产出的完整镜像逐文件收入 Product ZIP，不重建任何控制字段。 */
async function runtimeImageZipEntries(imageRoot: string): Promise<ZipEntry[]> {
    const entries: ZipEntry[] = [];

    async function walk(directory: string): Promise<void> {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const absolutePath = resolve(directory, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                await walk(absolutePath);
            } else if (entry.isFile() && !entry.isSymbolicLink()) {
                const archivePath = `.output/${relative(imageRoot, absolutePath).replaceAll("\\", "/")}`;
                entries.push({kind: "file", source: absolutePath, archivePath});
            } else {
                throw new Error(`测试 Runtime Image 包含不受支持的 entry：${absolutePath}`);
            }
        }
    }

    await walk(imageRoot);
    return entries.sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

/** 测试专用：把指定中央目录 entry 标记为 Unix symbolic link。 */
function markCentralEntryAsSymlink(archive: Uint8Array, target: string): void {
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const nameLength = view.getUint16(offset + 28, true);
        const name = Buffer.from(archive.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
        if (name !== target) continue;
        view.setUint8(offset + 5, 3);
        view.setUint32(offset + 38, (0o120777 << 16) >>> 0, true);
        return;
    }
    throw new Error(`测试 ZIP 缺少中央目录 entry：${target}`);
}

function sha256Identity(value: string): string {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function releaseBuildId(revision = REVISION): string {
    return computeReleaseBuildId({
        lockfileSha256: sha256Identity(LOCKFILE),
        revision,
        version: VERSION,
    });
}

async function temporaryRoot(): Promise<string> {
    const root = await mkdtemp(resolve(tmpdir(), "nbook-portable-provenance-"));
    cleanupRoots.push(root);
    return root;
}
