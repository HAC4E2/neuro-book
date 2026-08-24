// @vitest-environment jsdom
import {createApp, defineComponent, h, nextTick} from "vue";
import {describe, expect, it} from "vitest";
import {useUnsavedGuard} from "nbook/app/components/novel-ide/text-to-image/leave-guard";

type Mounted = {
    exposed: Record<string, unknown> | undefined;
    unmount: () => void;
};

function mountGuard(): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = createApp(defineComponent({
        setup(_props, {expose}) {
            let dirty = true;
            const guard = useUnsavedGuard({
                hasUnsavedChanges: () => dirty,
                save: async () => false,
                saveStaged: async () => {
                    if (!dirty) return "saved";
                    dirty = false;
                    return "pending-confirmation";
                },
                discard: () => {
                    dirty = false;
                },
            });
            expose({guard, markDirty: () => { dirty = true; }, isDirty: () => dirty});
            return () => h("div");
        },
    }));
    app.mount(host);
    return {
        exposed: app._instance?.exposed as Record<string, unknown> | undefined,
        unmount: () => {
            app.unmount();
            host.remove();
        },
    };
}

async function settle(): Promise<void> {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("leave guard 续接合同", () => {
    it("保存进入第二层确认时保护保持 pending，确认成功后只继续一次", async () => {
        const mount = mountGuard();
        const guard = mount.exposed!.guard as ReturnType<typeof useUnsavedGuard>;
        let resolved: boolean | null = null;
        const pending = guard.guard("离开前请先处理未保存修改").then((value) => { resolved = value; });
        await settle();
        expect(guard.pendingMessage.value).toBe("离开前请先处理未保存修改");

        await guard.chooseSave();
        await settle();
        expect(resolved).toBeNull();
        expect(guard.pendingMessage.value).toBe("离开前请先处理未保存修改");

        guard.resolveStagedSave(true);
        await pending;
        expect(resolved).toBe(true);
        expect(guard.pendingMessage.value).toBeNull();

        guard.resolveStagedSave(true);
        await settle();
        expect(resolved).toBe(true);
        mount.unmount();
    });

    it("第二层确认失败保持 dirty 与保护，取消后原始动作不继续", async () => {
        const mount = mountGuard();
        const guard = mount.exposed!.guard as ReturnType<typeof useUnsavedGuard>;
        let resolved: boolean | null = null;
        const pending = guard.guard("切换 Project 会丢失修改").then((value) => { resolved = value; });
        await settle();

        await guard.chooseSave();
        await settle();
        guard.resolveStagedSave(false);
        await settle();
        expect(resolved).toBeNull();
        expect(guard.pendingMessage.value).toBe("切换 Project 会丢失修改");

        guard.chooseCancel();
        await pending;
        expect(resolved).toBe(false);
        expect(guard.pendingMessage.value).toBeNull();
        mount.unmount();
    });

    it("普通保存失败不清空保护，可重试或放弃", async () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        let dirty = true;
        let attempt = 0;
        const app = createApp(defineComponent({
            setup(_props, {expose}) {
                const guard = useUnsavedGuard({
                    hasUnsavedChanges: () => dirty,
                    save: async () => {
                        attempt += 1;
                        if (attempt === 1) return false;
                        dirty = false;
                        return true;
                    },
                    discard: () => { dirty = false; },
                });
                expose({guard});
                return () => h("div");
            },
        }));
        app.mount(host);
        const guard = app._instance?.exposed?.guard as ReturnType<typeof useUnsavedGuard>;
        let resolved: boolean | null = null;
        const pending = guard.guard("请保存修改").then((value) => { resolved = value; });
        await settle();

        await guard.chooseSave();
        await settle();
        expect(resolved).toBeNull();
        expect(guard.pendingMessage.value).toBe("请保存修改");

        await guard.chooseSave();
        await pending;
        expect(resolved).toBe(true);
        app.unmount();
        host.remove();
    });
});
