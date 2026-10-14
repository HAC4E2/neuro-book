import {describe, expect, test} from "bun:test";
import {effectScope} from "vue";
import {stopPanelData} from "../src/web/host/panel-data.js";
import {useTerminalSocket} from "../src/web/host/terminal-socket.js";
import {useWebEnv} from "./web-env.js";

/** 网页终端的连接（`host/terminal-socket.ts`，L3）：页面在后台时的建连（t15 阶段 1.8）。环境见 `tests/web-env.ts`。 */
// 用例中途失败时也停掉建过的连接（摘掉 visibilitychange 监听、取消重连），不连累后面的用例。
const scopes: Array<() => void> = [];
const web = useWebEnv(() => {
    for (const stop of scopes.splice(0)) stop();
    stopPanelData();
});

const TARGET = {paneId: "w4:p1", terminalId: "term_a"};

function mount() {
    const scope = effectScope();
    scopes.push(() => scope.stop());
    const socket = scope.run(() => useTerminalSocket(TARGET))!;
    return {socket, stop: () => scope.stop()};
}

describe("在后台建起的终端连接（1.8）", () => {
    test("建起时页面在后台：不连、记为暂停；回到前台连上", () => {
        web.env.document.visibilityState = "hidden";
        const {socket} = mount();
        expect([web.env.sockets().length, socket.state.status]).toEqual([0, "paused"]);
        web.env.setVisibility("visible");
        expect([web.env.sockets().length, socket.state.status]).toEqual([1, "connecting"]);
        expect(web.env.sockets()[0]!.url).toContain("terminal=term_a");
        web.env.sockets()[0]!.open();
        expect(socket.state.status).toBe("open");
    });

    test("在后台建起、回到前台之前已经离开会话详情：不连", () => {
        web.env.document.visibilityState = "hidden";
        const {stop} = mount();
        stop();
        web.env.setVisibility("visible");
        expect(web.env.sockets().length).toBe(0);
    });

    test("回归：接管中切到后台先释放再关；回来只恢复观看，不自动重新接管", () => {
        const {socket} = mount();
        const first = web.env.sockets()[0]!;
        first.open();
        first.push({t: "state", mode: "control", cols: 120, rows: 40, sizeKnown: true, controller: {by: "this", since: "2026-10-13T00:00:00Z", device: "桌面"}});
        web.env.setVisibility("hidden");
        expect(first.sent.map((line) => JSON.parse(line) as unknown)).toEqual([{t: "release", reason: "hidden"}]);
        expect([first.closedWith?.code, socket.state.status, socket.state.mode]).toEqual([1000, "paused", "watch"]);
        web.env.setVisibility("visible");
        expect(web.env.sockets().length).toBe(2);
        const second = web.env.sockets()[1]!;
        second.open();
        expect([socket.state.status, socket.state.mode, second.sent]).toEqual(["open", "watch", []]);
    });
});
