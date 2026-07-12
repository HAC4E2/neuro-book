import {readonly, ref} from "vue";

/**
 * Tauri 桌面壳桥接的最小接口。仅当应用以 NeuroBook 桌面壳启动时
 * （tauri.conf.json withGlobalTauri=true，webview 注入 window.__TAURI__）可用；
 * 浏览器 / SSR 环境降级为不可用，调用方应据此隐藏桌面专属 UI。
 */

/** withGlobalTauri 注入的全局对象子集，仅声明用到的 core.invoke。 */
interface TauriGlobal {
    core: {
        invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    };
}

/** 取 window.__TAURI__，不存在返回 null（非桌面环境）。 */
function tauriGlobal(): TauriGlobal | null {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {__TAURI__?: TauriGlobal};
    return w.__TAURI__ ?? null;
}

/** useDesktopBridge 返回类型。 */
export interface DesktopBridge {
    /** 是否运行在桌面壳内（window.__TAURI__ 存在）。 */
    readonly isDesktop: Readonly<ReturnType<typeof ref<boolean>>>;
    /** 查询当前生效 data 目录绝对路径；非桌面环境或未就绪时返回 null。 */
    getDataDir: () => Promise<string | null>;
    /** 查询迁移进度文案，null 表示无迁移进行。 */
    getMigrationProgress: () => Promise<string | null>;
    /**
     * 切换 data 目录：写 pendingMove 后桌面壳自动重启执行迁移。
     * 成功返回新路径并触发重启；失败抛错，调用方展示。注意调用成功后
     * 应用很快重启，调用前应提示用户“即将重启迁移”。
     */
    changeDataDir: (path: string) => Promise<string>;
}

/**
 * 桌面桥接 composable。返回 Tauri invoke 封装与桌面环境标志。
 */
export function useDesktopBridge(): DesktopBridge {
    const isDesktop = ref<boolean>(tauriGlobal() !== null);

    async function getDataDir(): Promise<string | null> {
        const t = tauriGlobal();
        if (!t) return null;
        try {
            return await t.core.invoke<string | null>("get_data_dir");
        } catch {
            return null;
        }
    }

    async function getMigrationProgress(): Promise<string | null> {
        const t = tauriGlobal();
        if (!t) return null;
        try {
            return await t.core.invoke<string | null>("get_migration_progress");
        } catch {
            return null;
        }
    }

    async function changeDataDir(path: string): Promise<string> {
        const t = tauriGlobal();
        if (!t) throw new Error("当前环境不支持桌面数据目录（非桌面应用）");
        return await t.core.invoke<string>("change_data_dir", {path});
    }

    return {
        isDesktop: readonly(isDesktop),
        getDataDir,
        getMigrationProgress,
        changeDataDir,
    };
}
