import {ref} from "vue";

export type UnsavedGuardSaveStatus = "saved" | "pending-confirmation" | "failed";

export type UnsavedGuardApi = {
    /** 有未保存修改时打开“保存 / 放弃 / 取消”确认；返回是否允许继续。 */
    guard: (message: string) => Promise<boolean>;
    /** 确认对话框是否可见与提示文案。 */
    pendingMessage: Readonly<ReturnType<typeof ref<string | null>>>;
    /** Dialog 内部按钮：保存、放弃、取消。保存失败或进入下一层确认时保护保持打开。 */
    chooseSave: () => Promise<void>;
    chooseDiscard: () => void;
    chooseCancel: () => void;
    /** 多层确认完成后的续接入口：成功才解除保护并继续原始动作，失败保持 dirty 与保护。 */
    resolveStagedSave: (saved: boolean) => void;
};

/**
 * 统一的“保存、放弃、取消”离开保护：Project 切换、页面切换和工作台关闭复用。
 * 保存回调只有在明确成功后才解除保护；需要第二层确认时进入 pending 状态，
 * 由业务组件在确认完成后调用 `resolveStagedSave` 续接原始动作。
 */
export function useUnsavedGuard(input: {
    hasUnsavedChanges: () => boolean;
    save: () => Promise<boolean>;
    /** 需要区分“成功 / 进入下一层确认 / 失败”时使用；缺省时按 save 的布尔结果处理。 */
    saveStaged?: () => Promise<UnsavedGuardSaveStatus>;
    discard: () => void;
}): UnsavedGuardApi {
    const pendingMessage = ref<string | null>(null);
    let resolveGuard: ((allowed: boolean) => void) | null = null;

    function guard(message: string): Promise<boolean> {
        if (!input.hasUnsavedChanges()) return Promise.resolve(true);
        if (resolveGuard) return Promise.resolve(false);
        pendingMessage.value = message;
        return new Promise((resolve) => {
            resolveGuard = resolve;
        });
    }

    function finishGuard(saved: boolean): void {
        const resolve = resolveGuard;
        if (!resolve) return;
        pendingMessage.value = null;
        resolveGuard = null;
        resolve(saved);
    }

    async function chooseSave(): Promise<void> {
        if (!resolveGuard) return;
        if (input.saveStaged) {
            const status = await input.saveStaged();
            if (status === "saved") finishGuard(true);
            return;
        }
        const saved = await input.save();
        if (saved) finishGuard(true);
    }

    function resolveStagedSave(saved: boolean): void {
        if (saved) finishGuard(true);
    }

    function chooseDiscard(): void {
        const resolve = resolveGuard;
        pendingMessage.value = null;
        resolveGuard = null;
        input.discard();
        resolve?.(true);
    }

    function chooseCancel(): void {
        const resolve = resolveGuard;
        pendingMessage.value = null;
        resolveGuard = null;
        resolve?.(false);
    }

    return {guard, pendingMessage, chooseSave, chooseDiscard, chooseCancel, resolveStagedSave};
}
