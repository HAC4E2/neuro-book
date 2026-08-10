import {createHash} from "node:crypto";
import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    findTextToImageAssetByRelativePath,
    listTextToImageAssets,
    saveTextToImageAsset,
} from "nbook/server/text-to-image/asset.service";
import type {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

const PROJECT_NAME = "demo-project";

let workspaceRoot: string;
let projectRoot: string;

beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(tmpdir(), "nbook-asset-service-"));
    projectRoot = path.join(workspaceRoot, PROJECT_NAME);
    setWorkspaceRuntimeRootContextForTest({workspaceRoot});
});

afterEach(async () => {
    setWorkspaceRuntimeRootContextForTest(null);
    await rm(workspaceRoot, {recursive: true, force: true});
});

describe("saveTextToImageAsset", () => {
    it("写入文件、创建 DB 记录并返回 DTO", async () => {
        const fake = new FakePrismaClient();
        fake.jobs.set("job-1", {id: "job-1"});
        const bytes = new TextEncoder().encode("fake-png-bytes");

        const dto = await saveTextToImageAsset({
            projectPath: PROJECT_NAME,
            jobId: "job-1",
            bytes,
            mimeType: "image/png",
            width: 832,
            height: 1216,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad quality",
            sourceKind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "p_0001",
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        });

        expect(dto).toMatchObject({
            id: expect.any(String),
            jobId: "job-1",
            relativePath: `assets/tti/${dto.id}.png`,
            fileName: `${dto.id}.png`,
            mimeType: "image/png",
            byteLength: bytes.byteLength,
            width: 832,
            height: 1216,
            model: "nai-diffusion-4-5-full",
            seed: 42,
            prompt: "1girl",
            negativePrompt: "bad quality",
            sourceKind: "body",
            sourcePath: "manuscript/chapter-1.md",
            sourceAnchorId: "p_0001",
        });
        expect(typeof dto.createdAt).toBe("string");
        expect(fake.assets).toHaveLength(1);
        expect(fake.assets[0]?.contentHash).toBe(createHash("sha256").update(bytes).digest("hex"));

        const assetDirectory = path.join(projectRoot, "assets", "tti");
        expect(await readdir(assetDirectory)).toEqual([`${dto.id}.png`]);
        expect(await readFile(path.join(assetDirectory, `${dto.id}.png`))).toEqual(Buffer.from(bytes));
    });

    it("job 不存在时拒绝保存且不写文件", async () => {
        const fake = new FakePrismaClient();
        const bytes = new Uint8Array([1, 2, 3]);

        await expect(saveTextToImageAsset({
            projectPath: PROJECT_NAME,
            jobId: "missing-job",
            bytes,
            mimeType: "image/png",
            width: 1,
            height: 1,
            model: "model",
            seed: 1,
            prompt: "prompt",
            negativePrompt: "",
            sourceKind: "manual",
            sourcePath: null,
            sourceAnchorId: null,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        })).rejects.toThrow(/任务不存在/);

        expect(fake.assets).toHaveLength(0);
        await expect(readdir(path.join(projectRoot, "assets"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("DB 写入失败时删除已落盘的文件", async () => {
        const fake = new FakePrismaClient();
        fake.jobs.set("job-1", {id: "job-1"});
        fake.failNextCreate = true;

        await expect(saveTextToImageAsset({
            projectPath: PROJECT_NAME,
            jobId: "job-1",
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: "image/webp",
            width: 1,
            height: 1,
            model: "model",
            seed: 1,
            prompt: "prompt",
            negativePrompt: "",
            sourceKind: "manual",
            sourcePath: null,
            sourceAnchorId: null,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        })).rejects.toThrow("db create failed");

        expect(fake.assets).toHaveLength(0);
        expect(await readdir(path.join(projectRoot, "assets", "tti"))).toEqual([]);
    });
});

describe("listTextToImageAssets", () => {
    it("按 createdAt 倒序分页并返回 hasMore", async () => {
        const fake = new FakePrismaClient();
        for (let index = 0; index < 5; index++) {
            fake.assets.push(fakeAssetRecord(`asset-${index}`, new Date(`2026-08-0${index + 1}T00:00:00.000Z`)));
        }

        const firstPage = await listTextToImageAssets({
            projectPath: PROJECT_NAME,
            page: 1,
            pageSize: 2,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        });
        expect(firstPage.items.map((item) => item.id)).toEqual(["asset-4", "asset-3"]);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.page).toBe(1);
        expect(firstPage.pageSize).toBe(2);

        const lastPage = await listTextToImageAssets({
            projectPath: PROJECT_NAME,
            page: 3,
            pageSize: 2,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        });
        expect(lastPage.items.map((item) => item.id)).toEqual(["asset-0"]);
        expect(lastPage.hasMore).toBe(false);
    });

    it("pageSize 超过 100 时按 100 截断", async () => {
        const fake = new FakePrismaClient();
        for (let index = 0; index < 105; index++) {
            fake.assets.push(fakeAssetRecord(`asset-${index}`, new Date(Date.UTC(2026, 7, 3, 0, 0, index))));
        }

        const page = await listTextToImageAssets({
            projectPath: PROJECT_NAME,
            pageSize: 200,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        });
        expect(page.pageSize).toBe(100);
        expect(page.items).toHaveLength(100);
        expect(page.hasMore).toBe(true);
    });

    it("can list only the version chain for one source anchor", async () => {
        const fake = new FakePrismaClient();
        fake.assets.push({...fakeAssetRecord("anchor-2", new Date("2026-08-03T00:00:00.000Z")), sourceAnchorId: "p1"});
        fake.assets.push({...fakeAssetRecord("other", new Date("2026-08-04T00:00:00.000Z")), sourceAnchorId: "p2"});
        fake.assets.push({...fakeAssetRecord("anchor-1", new Date("2026-08-02T00:00:00.000Z")), sourceAnchorId: "p1"});

        const page = await listTextToImageAssets({
            projectPath: PROJECT_NAME,
            sourceAnchorId: "p1",
            pageSize: 10,
            client: () => Promise.resolve(fake as unknown as PrismaClient),
        });

        expect(page.items.map((item) => item.id)).toEqual(["anchor-2", "anchor-1"]);
        expect(page.hasMore).toBe(false);
    });
});

describe("findTextToImageAssetByRelativePath", () => {
    it("finds the newest asset record by relative path", async () => {
        const fake = new FakePrismaClient();
        fake.assets.push(fakeAssetRecord("asset-1", new Date("2026-08-02T00:00:00.000Z")));
        fake.assets.push(fakeAssetRecord("asset-2", new Date("2026-08-01T00:00:00.000Z")));

        const dto = await findTextToImageAssetByRelativePath(
            PROJECT_NAME,
            "assets/tti/asset-1.png",
            () => Promise.resolve(fake as unknown as PrismaClient),
        );

        expect(dto).toMatchObject({
            id: "asset-1",
            relativePath: "assets/tti/asset-1.png",
        });
    });

    it("returns null when no asset matches", async () => {
        const fake = new FakePrismaClient();

        const dto = await findTextToImageAssetByRelativePath(
            PROJECT_NAME,
            "assets/tti/missing.png",
            () => Promise.resolve(fake as unknown as PrismaClient),
        );

        expect(dto).toBeNull();
    });
});

type FakeAssetRecord = {
    id: string;
    jobId: string;
    relativePath: string;
    fileName: string;
    mimeType: string;
    byteLength: number;
    width: number;
    height: number;
    model: string;
    seed: number;
    prompt: string;
    negativePrompt: string;
    sourceKind: string;
    sourcePath: string | null;
    sourceAnchorId: string | null;
    contentHash: string;
    createdAt: Date;
};

class FakePrismaClient {
    jobs = new Map<string, {id: string}>();
    assets: FakeAssetRecord[] = [];
    failNextCreate = false;

    textToImageJob = {
        findUnique: async ({where}: {where: {id: string}}): Promise<{id: string} | null> =>
            this.jobs.get(where.id) ?? null,
    };

    textToImageAsset = {
        create: async ({data}: {data: FakeAssetRecord}): Promise<FakeAssetRecord> => {
            if (this.failNextCreate) {
                throw new Error("db create failed");
            }
            const record: FakeAssetRecord = {
                ...data,
                createdAt: data.createdAt ?? new Date("2026-08-03T08:00:00.000Z"),
            };
            this.assets.push(record);
            return record;
        },
        findMany: async ({skip = 0, take = this.assets.length, where}: {skip?: number; take?: number; where?: {sourceAnchorId?: string}}): Promise<FakeAssetRecord[]> => {
            const filtered = where?.sourceAnchorId === undefined
                ? this.assets
                : this.assets.filter((item) => item.sourceAnchorId === where.sourceAnchorId);
            const sorted = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return sorted.slice(skip, skip + take);
        },
        findFirst: async ({where}: {where: {relativePath?: string; sourceAnchorId?: string}}): Promise<FakeAssetRecord | null> => {
            const sorted = [...this.assets].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return sorted.find((item) => (
                (where.relativePath === undefined || item.relativePath === where.relativePath)
                && (where.sourceAnchorId === undefined || item.sourceAnchorId === where.sourceAnchorId)
            )) ?? null;
        },
        count: async ({where}: {where?: {sourceAnchorId?: string}} = {}): Promise<number> => where?.sourceAnchorId === undefined
            ? this.assets.length
            : this.assets.filter((item) => item.sourceAnchorId === where.sourceAnchorId).length,
    };
}

function fakeAssetRecord(id: string, createdAt: Date): FakeAssetRecord {
    return {
        id,
        jobId: "job-1",
        relativePath: `assets/tti/${id}.png`,
        fileName: `${id}.png`,
        mimeType: "image/png",
        byteLength: 4,
        width: 1,
        height: 1,
        model: "model",
        seed: 1,
        prompt: "prompt",
        negativePrompt: "",
        sourceKind: "manual",
        sourcePath: null,
        sourceAnchorId: null,
        contentHash: "hash",
        createdAt,
    };
}
