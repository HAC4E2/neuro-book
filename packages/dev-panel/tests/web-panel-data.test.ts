import {describe, expect, test} from "bun:test";
import {effectScope} from "vue";
import {panelState, startPanelData, stopPanelData, useResource} from "../src/web/host/panel-data.js";
import {until, useWebEnv} from "./web-env.js";

/** 数据宿主（`host/panel-data.ts`，L3）：推送、重取与收口。环境见 `tests/web-env.ts`。 */
const web = useWebEnv();

describe("数据宿主的收口", () => {
    test("stopPanelData 关掉推送连接、取消重连；之后能再 startPanelData", async () => {
        startPanelData();
        const first = web.env.sockets()[0]!;
        first.open();
        first.serverClose();
        // 断开之后排了一次重连；stop 要把它取消。
        stopPanelData();
        await Bun.sleep(1_200);
        expect(web.env.sockets().length).toBe(1);
        startPanelData();
        expect(web.env.sockets().length).toBe(2);
        stopPanelData();
        expect(web.env.sockets()[1]!.closedWith).not.toBeNull();
        expect(panelState.connection).toBe("connecting");
    });

    test("资源在 scope 里取数，推送说它订阅的那块变了就重取", async () => {
        web.env.respond((call) => (call.url === "/api/overview" ? {data: {n: web.env.calls.length}} : undefined));
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        const scope = effectScope();
        const resource = scope.run(() => useResource<{n: number}>(() => "/api/overview", ["records"]))!;
        await until(() => resource.data.value, (value) => value !== null);
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: {records: 2, activity: 1, sessions: 1, notify: 1, github: 1}});
        await until(() => web.env.calls.length, (count) => count === 2);
        scope.stop();
        stopPanelData();
    });
});
