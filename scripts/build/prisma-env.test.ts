import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
const originalDatabaseKind = process.env.DATABASE_KIND;
const originalDatabaseUrl = process.env.DATABASE_URL;
let root: string | null = null;

afterEach(async () => {
    restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
    restoreEnv("DATABASE_KIND", originalDatabaseKind);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    vi.resetModules();
    if (root) await rm(root, {recursive: true, force: true});
    root = null;
});

describe("Prisma CLI State Root", () => {
    it("将相对 SQLite URL 规范化为 State Root 下的绝对 URL", async () => {
        root = await mkdtemp(join(tmpdir(), "nbook-prisma-env-"));
        const stateRoot = join(root, "data");
        process.env.NEURO_BOOK_STATE_ROOT = stateRoot;
        process.env.DATABASE_KIND = "sqlite";
        process.env.DATABASE_URL = "file:./workspace/.nbook/neuro-book.sqlite";

        const {preparePrismaEnv} = await import("../db/prisma-env.mjs");
        const result = preparePrismaEnv();
        const expectedPath = join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite").replaceAll("\\", "/");

        expect(result.databaseUrl).toBe(`file:${expectedPath}`);
        expect(process.env.DATABASE_URL).toBe(`file:${expectedPath}`);
    });

    it("为 Windows 子进程清除数据库环境变量的大小写冲突", async () => {
        const prismaEnv = await import("../db/prisma-env.mjs");

        expect(prismaEnv.prismaChildEnvironment).toBeTypeOf("function");
        const environment = prismaEnv.prismaChildEnvironment({
            Path: "C:/Windows/System32",
            database_url: "file:C:/stale.sqlite?mode=ro",
            Database_Kind: "postgresql",
        }, {
            kind: "sqlite",
            databaseUrl: "file:C:/data/neuro-book.sqlite",
        });

        expect(Object.keys(environment).filter((key) => key.toUpperCase() === "DATABASE_URL")).toEqual(["DATABASE_URL"]);
        expect(Object.keys(environment).filter((key) => key.toUpperCase() === "DATABASE_KIND")).toEqual(["DATABASE_KIND"]);
        expect(environment.DATABASE_URL).toBe("file:C:/data/neuro-book.sqlite");
        expect(environment.DATABASE_KIND).toBe("sqlite");
        expect(environment.Path).toBe("C:/Windows/System32");
    });
});

function restoreEnv(name: "NEURO_BOOK_STATE_ROOT" | "DATABASE_KIND" | "DATABASE_URL", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
