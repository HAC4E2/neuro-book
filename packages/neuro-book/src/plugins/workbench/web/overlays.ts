/**
 * 页面浮层（docs/specs/ui/workbench-shell.md 输出 41）：汇集 `workbench.overlays` 的贡献，页面根上每个已交付的浮层挂一份。
 *
 * - 句柄在 `published` 时记下、`revoke` 时去掉；贡献方入口开始停止时句柄先失去 `published`，浮层随即卸载。
 * - 每个浮层各自加载、各自出错：`load()` 失败或组件渲染出错只让这一个浮层不显示并记诊断，别的浮层与页面照常。
 * - 加载结果回来时这个浮层已卸载（撤回、入口停止、页面离开）就丢弃：不挂组件，也不记为失败。
 *
 * 用渲染函数而不是单文件组件：窗口的合同测试在 bun test 中导入真实的工作台插件，bun 不能加载 `.vue`。
 */

import {defineComponent, Fragment, h, markRaw, onErrorCaptured, onUnmounted, shallowRef} from "vue";
import type {Component, PropType, ShallowRef} from "vue";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {OverlayDeclaration} from "../shared/overlays";
import type {WorkbenchOverlayImplementation} from "./contracts";

export interface OverlayProvider {
    readonly id: string;
    load(): Promise<Component>;
}

export interface OverlaySource {
    /** 此刻要挂的浮层，按 order 再按 id；没有为空。同一次交付在重算之间保持同一个对象。 */
    readonly current: Readonly<ShallowRef<ReadonlyArray<OverlayProvider>>>;
}

type OverlayHandle = ContributionHandle<OverlayDeclaration, WorkbenchOverlayImplementation>;

export class OverlaySlot implements OverlaySource {
    readonly current = shallowRef<ReadonlyArray<OverlayProvider>>([]);
    readonly #published = new Map<string, {readonly handle: OverlayHandle; readonly provider: OverlayProvider}>();

    constructor(signal: AbortSignal) {
        // 工作台入口停止：浮层全部卸下，之后的交付不再收。
        signal.addEventListener("abort", () => {
            this.#published.clear();
            this.current.value = [];
        }, {once: true});
    }

    receiver(): ContributionReceiver<OverlayDeclaration, WorkbenchOverlayImplementation> {
        return {
            published: (handle) => {
                // 每次加载都经 implementation() 取实现：撤回后内核拒绝，不再用旧实现。新的交付换新对象，页面据此重新加载。
                this.#published.set(handle.id, {handle, provider: {id: handle.id, load: async () => handle.implementation().load()}});
                this.#publish();
            },
            revoke: (handle) => {
                if (this.#published.get(handle.id)?.handle !== handle) return;
                this.#published.delete(handle.id);
                this.#publish();
            },
        };
    }

    #publish(): void {
        this.current.value = [...this.#published.values()]
            .sort((a, b) => (a.handle.declaration.order ?? 0) - (b.handle.declaration.order ?? 0) || (a.handle.id < b.handle.id ? -1 : a.handle.id > b.handle.id ? 1 : 0))
            .map((entry) => entry.provider);
    }
}

/** 一个浮层：自己加载、自己接住渲染错误，出了错只是自己不显示。 */
const OverlayFrame = defineComponent({
    name: "WorkbenchOverlayFrame",
    props: {
        provider: {type: Object as PropType<OverlayProvider>, required: true},
        report: {type: Function as PropType<(message: string) => void>, required: true},
    },
    setup(props) {
        const component = shallowRef<Component | null>(null);
        const failed = shallowRef(false);
        let mounted = true;
        onUnmounted(() => {
            mounted = false;
        });
        const provider = props.provider;
        provider.load().then(
            (loaded) => {
                if (mounted) component.value = markRaw(loaded);
            },
            (error: unknown) => {
                if (!mounted) return;
                failed.value = true;
                props.report(`浮层 ${provider.id} 加载失败：${error instanceof Error ? error.message : String(error)}`);
            },
        );
        onErrorCaptured((error) => {
            failed.value = true;
            props.report(`浮层 ${provider.id} 出错，已卸下：${error instanceof Error ? error.message : String(error)}`);
            // 不再往上传：页面与别的浮层不受影响。
            return false;
        });
        return () => (failed.value || component.value === null ? null : h(component.value));
    },
});

/**
 * 页面根上的浮层宿主：每个浮层一个框，按交付的对象作 key，换了交付就重新加载。不包外层元素：页面根是外壳的承载盒，
 * 浮层的内容自己传送到页面之外（例如对话框传送到 body），不在页面里占位。
 */
export function createOverlayHost(source: OverlaySource, report: (message: string) => void): Component {
    const keys = new WeakMap<OverlayProvider, number>();
    let next = 0;
    const keyOf = (provider: OverlayProvider): number => {
        let key = keys.get(provider);
        if (key === undefined) {
            next += 1;
            key = next;
            keys.set(provider, key);
        }
        return key;
    };
    return defineComponent({
        name: "WorkbenchOverlays",
        setup: () => () => h(Fragment, source.current.value.map((provider) => h(OverlayFrame, {key: keyOf(provider), provider, report}))),
    });
}
