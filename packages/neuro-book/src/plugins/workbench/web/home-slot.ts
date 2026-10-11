/**
 * 无项目首页的提供者（docs/specs/ui/workbench-shell.md 输出 36）：汇集 `workbench.home` 的贡献。按已接受的声明数量裁决：
 * 恰好一个时采用它交付的实现（还没交付就先空着）；几个插件同时声明时全部不采用并记诊断（没有“谁先激活谁赢”，结果与登记
 * 和激活顺序无关）；交付与撤回后重新裁决。
 */

import {shallowRef} from "vue";
import type {Component, ShallowRef} from "vue";

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {WORKBENCH_HOME_POINT} from "../shared/home";
import type {HomeDeclaration} from "../shared/home";
import type {WorkbenchHomeImplementation} from "./contracts";

export interface HomeProvider {
    readonly id: string;
    load(): Promise<Component>;
}

export interface HomeSource {
    /** 此刻采用的首页；没有贡献或贡献多于一个时为 null。 */
    readonly current: Readonly<ShallowRef<HomeProvider | null>>;
}

export class HomeSlot implements HomeSource {
    readonly current = shallowRef<HomeProvider | null>(null);
    readonly #published = new Map<string, ContributionHandle<HomeDeclaration, WorkbenchHomeImplementation>>();
    readonly #declarations: ContributionDeclarations;
    readonly #report: (message: string) => void;
    /** 已记过诊断的那组冲突声明：同一组不在每次交付与撤回时重复记。 */
    #conflict: string | null = null;

    constructor(declarations: ContributionDeclarations, report: (message: string) => void) {
        this.#declarations = declarations;
        this.#report = report;
    }

    receiver(): ContributionReceiver<HomeDeclaration, WorkbenchHomeImplementation> {
        return {
            published: (handle) => {
                this.#published.set(handle.id, handle);
                this.#choose();
            },
            revoke: (handle) => {
                if (this.#published.get(handle.id) !== handle) return;
                this.#published.delete(handle.id);
                this.#choose();
            },
        };
    }

    #choose(): void {
        // 按此刻已接受的声明裁决（已按 id 排序）：声明了但入口还没激活或激活失败的也算一个，首页不取决于激活时序。
        const declared = this.#declarations.list<HomeDeclaration>(WORKBENCH_HOME_POINT);
        if (declared.length > 1) {
            const ids = declared.map((declaration) => declaration.id).join("、");
            if (this.#conflict !== ids) {
                this.#conflict = ids;
                this.#report(`首页有 ${String(declared.length)} 个声明，都不采用：${ids}`);
            }
            this.current.value = null;
            return;
        }
        this.#conflict = null;
        const chosen = declared[0] === undefined ? undefined : this.#published.get(declared[0].id);
        if (chosen === undefined) {
            this.current.value = null;
            return;
        }
        // 同一个提供者重复交付时不换对象：页面按对象身份决定是否重新加载。
        if (this.current.value?.id === chosen.id) return;
        // 每次加载都经 implementation() 取实现：贡献撤回后内核拒绝，不再用旧实现。
        this.current.value = {id: chosen.id, load: async () => chosen.implementation().load()};
    }
}
