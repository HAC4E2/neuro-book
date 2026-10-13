import {describe, expect, test} from "bun:test";
import {effectScope} from "vue";
import {getJson, sendJson, streamLines} from "../src/web/host/api.js";
import {confirmRelogin, panelState, startPanelData, stopPanelData, useResource} from "../src/web/host/panel-data.js";
import {useWrite} from "../src/web/host/writes.js";
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

describe("登录失效与重新登录（1.5）", () => {
    test("写请求回 401：进入失效状态，useWrite 仍拿到局部的失败；推送连接关掉、不再重连，推送与 reload 都不发请求", async () => {
        web.env.respond((call) => (call.url === "/api/overview" ? {data: {n: 1}} : undefined));
        web.env.respond((call) => (call.method === "POST" ? {status: 401, errors: [{code: "unauthorized", message: "没有登录"}]} : undefined));
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        const scope = effectScope();
        const {resource, write} = scope.run(() => ({resource: useResource<{n: number}>(() => "/api/overview", ["records"]), write: useWrite()}))!;
        await until(() => resource.data.value, (value) => value !== null);
        const outcome = await write.run(() => sendJson("POST", "/api/works", {}));
        expect(outcome.ok).toBe(false);
        expect(panelState.unauthorized).toBe(true);
        expect(socket.closedWith).not.toBeNull();
        const before = web.env.calls.length;
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: {records: 5, activity: 1, sessions: 1, notify: 1, github: 1}});
        resource.reload();
        await Bun.sleep(1_200);
        expect([web.env.calls.length, web.env.sockets().length]).toEqual([before, 1]);
        expect(resource.data.value).toEqual({n: 1});
        scope.stop();
        stopPanelData();
    });

    test("回应不是 JSON 的 401、流式搜索的 401 同样进入失效状态", async () => {
        web.env.respond((call) => (call.url === "/api/raw" ? {status: 401, raw: "unauthorized"} : undefined));
        await expect(getJson("/api/raw")).rejects.toMatchObject({status: 401});
        expect(panelState.unauthorized).toBe(true);
        stopPanelData();
        expect(panelState.unauthorized).toBe(false);
        web.env.respond((call) => (call.url.startsWith("/api/search") ? {status: 401} : undefined));
        await expect(streamLines("/api/search?q=xx", () => undefined, new AbortController().signal)).rejects.toMatchObject({status: 401});
        expect(panelState.unauthorized).toBe(true);
        stopPanelData();
    });

    test("同一实例里失效再重新登录：authEpoch 加一，重连推送，每个订阅了的资源各重取一次", async () => {
        let lost = false;
        web.env.respond((call) => (lost && call.url !== "/api/meta" ? {status: 401} : undefined));
        web.env.respond((call) => (call.url === "/api/overview" ? {data: {n: 1}} : call.url === "/api/meta" ? {data: {}} : call.url === "/api/notify" ? {data: {jobs: []}} : undefined));
        startPanelData();
        web.env.sockets()[0]!.open();
        const scope = effectScope();
        const resources = scope.run(() => [useResource(() => "/api/overview", ["records"]), useResource(() => "/api/notify", ["notify"])])!;
        await until(() => resources.every((resource) => resource.data.value !== null), (ok) => ok);
        lost = true;
        resources[0]!.reload();
        await until(() => panelState.unauthorized, (value) => value);
        lost = false;
        const before = web.env.calls.length;
        expect(await confirmRelogin()).toBeNull();
        expect([panelState.unauthorized, panelState.authEpoch, web.env.sockets().length]).toEqual([false, 1, 2]);
        await until(() => web.env.calls.length, (count) => count >= before + 3);
        await Bun.sleep(20);
        expect(web.env.calls.slice(before).map((call) => call.url).sort()).toEqual(["/api/meta", "/api/notify", "/api/overview"]);
        scope.stop();
        stopPanelData();
    });

    test("重新登录时还是 401：留在失效状态，给出原因", async () => {
        web.env.respond(() => ({status: 401}));
        startPanelData();
        await expect(confirmRelogin()).resolves.toContain("还是没有登录");
        expect(panelState.unauthorized).toBe(true);
        stopPanelData();
    });
});
