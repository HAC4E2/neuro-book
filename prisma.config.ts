import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as yaml from "yaml";
import {defineConfig, env} from "prisma/config";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(process.env.NEURO_BOOK_APPLICATION_ROOT?.trim() || moduleRoot);
const databaseUrl = resolveDatabaseUrl(applicationRoot);
process.env.NEURO_BOOK_APPLICATION_ROOT = applicationRoot;
process.env.DATABASE_KIND = "sqlite";
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
    schema: "prisma/schema.sqlite.prisma",
    datasource: {
        url: env("DATABASE_URL"),
    },
    migrations: {
        path: "prisma/migrations/sqlite",
    },
});

function resolveDatabaseUrl(applicationRoot: string): string {
    const envUrl = normalizeText(process.env.DATABASE_URL);
    const bootUrl = normalizeText(readBootDatabaseConfig(applicationRoot).url);
    const url = envUrl || bootUrl || "file:./workspace/.nbook/neuro-book.sqlite";
    if (!url.startsWith("file:")) {
        throw new Error(`Prisma App SQLite 只支持 file: URL，当前为：${url}`);
    }
    return url;
}

function readBootDatabaseConfig(applicationRoot: string): {url?: unknown} {
    const configPath = path.resolve(applicationRoot, "config.yaml");
    if (!fs.existsSync(configPath)) {
        return {};
    }

    const text = fs.readFileSync(configPath, "utf-8");
    const expanded = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g, (_match, name: string, fallback: string | undefined) => {
        const value = process.env[name];
        return value !== undefined && value !== "" ? value : fallback ?? "";
    });
    const parsed = yaml.parse(expanded) as {database?: {url?: unknown}} | null;
    return parsed?.database && typeof parsed.database === "object" ? parsed.database : {};
}

function normalizeText(input: unknown): string {
    return typeof input === "string" ? input.trim() : "";
}
