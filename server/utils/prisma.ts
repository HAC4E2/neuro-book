import {PrismaPg} from "@prisma/adapter-pg";
import {PrismaClient} from "nbook/server/generated/prisma/client";

/**
 * 全局 Prisma 缓存类型。
 * 用于开发环境热更新时复用连接，避免重复创建客户端。
 */
type GlobalPrisma = {
    prismaClient?: PrismaClient;
};

const globalForPrisma = globalThis as typeof globalThis & GlobalPrisma;

/**
 * 创建 PrismaClient 实例。
 * 仅负责实例化，不做缓存逻辑。
 */
const createPrismaClient = (): PrismaClient => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL 未配置，无法初始化 PrismaClient");
    }

    const adapter = new PrismaPg({
        connectionString: databaseUrl,
    });

    return new PrismaClient({
        adapter,
    });
};

/**
 * 获取 PrismaClient 单例。
 * - 开发环境：复用 globalThis 上的实例，避免 HMR 导致连接过多
 * - 生产环境：直接返回新建实例（进程级生命周期由运行时管理）
 */
export const usePrismaClient = (): PrismaClient => {
    if (process.env.NODE_ENV === "production") {
        return createPrismaClient();
    }

    if (!globalForPrisma.prismaClient) {
        globalForPrisma.prismaClient = createPrismaClient();
    }

    return globalForPrisma.prismaClient;
};

/**
 * 便捷导出：适合在 server/api 中直接使用。
 */
export const prisma = usePrismaClient();
