import {PrismaClient} from "nbook/server/generated/project-prisma/client";
import {PROJECT_DATABASE_MODULE_TOKEN} from "nbook/server/workspace-files/project-database-module";
import {
    projectModuleToken,
    registerProjectModule,
    type ProjectModule,
    type ProjectModuleHandle,
} from "nbook/server/workspace-files/project-module";
import {toSqliteFileUrl} from "nbook/server/workspace-files/project-workspace";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {TrackedPrismaLibSql} from "nbook/server/workspace-files/tracked-prisma-libsql";

/** 文生图 Module 当前 generation 持有的 Prisma 数据面资源。 */
export interface TextToImageProjectClientHandle extends ProjectModuleHandle {
    /** 首次访问时打开当前 generation 的 Project SQLite Prisma client；close 后调用会拒绝。 */
    client(): Promise<PrismaClient>;
}

/** 文生图 Project Prisma client 的稳定 typed token。 */
export const TEXT_TO_IMAGE_PROJECT_CLIENT_MODULE_TOKEN = projectModuleToken<TextToImageProjectClientHandle>(
    "text-to-image",
    "lazy",
);

/**
 * lazy 文生图 Prisma Module。
 *
 * handle 只持有本 generation 打开的精确 client；Project close/重开由 Session 统一驱动 close，
 * 取代旧 `registerProjectResourceOwner` 的进程级缓存 Map。
 */
export const textToImageProjectClientModule: ProjectModule<TextToImageProjectClientHandle> = Object.freeze({
    token: TEXT_TO_IMAGE_PROJECT_CLIENT_MODULE_TOKEN,

    /** 同步绑定同 generation Database handle，把 Prisma client 打开延迟到首次数据面访问。 */
    start(context) {
        const database = context.require(PROJECT_DATABASE_MODULE_TOKEN);
        const ready = Promise.resolve().then(() => context.signal.throwIfAborted());
        let closed = false;
        /** 已经打开的 client 与 adapter；未打开时为空，close 后置空。 */
        let opened: {client: PrismaClient; adapter: TrackedPrismaLibSql} | null = null;
        let openingPromise: Promise<PrismaClient> | null = null;

        return Object.freeze({
            ready,
            /** 数据面访问始终复用本 handle 自己的 client，不跨 generation 切槽。 */
            async client(): Promise<PrismaClient> {
                await ready;
                context.signal.throwIfAborted();
                if (closed) {
                    throw new Error("文生图 Project client handle 已经关闭");
                }
                if (!openingPromise) {
                    const opening = database.databasePath.then((databasePath) => {
                        context.signal.throwIfAborted();
                        if (closed) {
                            throw new Error("文生图 Project client handle 已经关闭");
                        }
                        const adapter = new TrackedPrismaLibSql({url: toSqliteFileUrl(databasePath)});
                        const client = new PrismaClient({adapter});
                        opened = {client, adapter};
                        return client;
                    }).catch((error: unknown) => {
                        if (openingPromise === opening && opened === null) {
                            openingPromise = null;
                        }
                        throw error;
                    });
                    openingPromise = opening;
                }
                return openingPromise;
            },
            /** 只关闭本 handle 捕获的精确 client；未打开时幂等 no-op。 */
            async close(): Promise<void> {
                closed = true;
                if (openingPromise) {
                    try {
                        await openingPromise;
                    } catch {
                        // client 尚未创建时无需把数据面 opening 失败升级为 close 失败。
                    }
                }
                const closing = opened;
                opened = null;
                openingPromise = null;
                if (!closing) {
                    return;
                }
                try {
                    await closing.client.$disconnect();
                } finally {
                    closing.adapter.closeTrackedClients();
                    collectReleasedSqliteHandles();
                }
            },
        });
    },
});

registerProjectModule(textToImageProjectClientModule);
