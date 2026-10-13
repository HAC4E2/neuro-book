import type {PanelState} from "./state.js";

/**
 * 本面板正在接管键盘的终端（t12），按 terminal id 记：pane 跨 workspace 移动会换 pane id，terminal id 与流都不变（设计审查 S5）。
 * 通知、会话页的文字与按键据此停发（herdr 不拦 API 写入，接管期间的 `agent.prompt` 照样会写进 pane）。
 */
export type ControlEntry = {connectionId: string; paneId: string; since: string; device: string};

export class ControlRegistry {
    private readonly entries = new Map<string, ControlEntry>();

    isControlled(terminalId: string): boolean {
        return this.entries.has(terminalId);
    }

    get(terminalId: string): ControlEntry | null {
        return this.entries.get(terminalId) ?? null;
    }

    set(terminalId: string, entry: ControlEntry): void {
        this.entries.set(terminalId, entry);
    }

    /** 只删自己登记的那一条（换手时另一条连接已经登记了新的）。 */
    release(terminalId: string, connectionId: string): void {
        if (this.entries.get(terminalId)?.connectionId === connectionId) this.entries.delete(terminalId);
    }
}

/**
 * 按 pane 串行的锁用 terminal id 作键（同一个终端换了 pane id 仍是同一把锁）；监视器的 pane 列表里还没有这格时退回 `pane:<pane id>`，
 * 锁内的 `agent.get` 再核一次“是否正被接管”。
 */
export function lockKeyOf(state: PanelState, paneId: string): string {
    const terminalId = state.herdr.current().panes.find((pane) => pane.paneId === paneId)?.terminalId;
    return terminalId ? terminalId : `pane:${paneId}`;
}
