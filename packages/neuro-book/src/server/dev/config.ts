/**
 * 开发模式参数：页面由 Vite 在 `NBOOK_DEV_PORT`（缺省 4217）提供，后端的 RPC 端口为 `NBOOK_DEV_RPC_PORT`（缺省 4218），
 * 后端 HTTP 在 `NBOOK_DEV_BACKEND_PORT`（缺省 4219，页面服务把 `/api` 代理到它）。三个都取缺省时作为一组顺延：任一被
 * 占用就一起加 100 再试，至多 10 组（与正式运行相同，见 `../ports.ts`），所以与正式运行的服务端可以同时跑；显式给出任何
 * 一个就不顺延。端口在整个开发会话中固定：后端重启前后 RPC 端口与代理目标都不变；后端 HTTP 端口为 0 表示启动时取一个空闲
 * 端口，此后同样固定。
 * 状态根缺省是包内被 git 忽略的 `.dev-state/`：每个 worktree 各一份，不碰旧应用的数据目录。
 */

import {join, resolve} from "node:path";

export interface DevConfig {
    readonly host: string;
    readonly pagePort: number;
    readonly backendPort: number;
    readonly rpcPort: number;
    /** 三个端口都取缺省：被占用时成组顺延。 */
    readonly shiftPorts: boolean;
    readonly stateRoot: string;
}

export class DevConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DevConfigError";
    }
}

export function readDevConfig(env: Readonly<Record<string, string | undefined>>, packageRoot: string): DevConfig {
    const stateRoot = env.NBOOK_STATE_ROOT?.trim();
    return {
        // 开发模式不加载鉴权插件，与后端宿主一样只监听本机。
        host: "127.0.0.1",
        pagePort: port(env, "NBOOK_DEV_PORT", 4217),
        backendPort: port(env, "NBOOK_DEV_BACKEND_PORT", 4219),
        rpcPort: port(env, "NBOOK_DEV_RPC_PORT", 4218),
        shiftPorts: ["NBOOK_DEV_PORT", "NBOOK_DEV_BACKEND_PORT", "NBOOK_DEV_RPC_PORT"].every((name) => !env[name]?.trim()),
        stateRoot: stateRoot ? resolve(packageRoot, stateRoot) : join(packageRoot, ".dev-state"),
    };
}

function port(env: Readonly<Record<string, string | undefined>>, name: string, fallback: number): number {
    const value = env[name]?.trim();
    if (!value) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new DevConfigError(`${name} 必须是 0..65535 的整数，收到 ${value}`);
    return parsed;
}
