import {afterEach, describe, expect, test} from "bun:test";
import {effectScope as createScope, ref, type EffectScope} from "vue";
import {getJson, sendJson, streamLines} from "../src/web/host/api.js";
import {confirmRelogin, panelState, startPanelData, stopPanelData, useResource} from "../src/web/host/panel-data.js";
import {useWrite} from "../src/web/host/writes.js";
import {until, useWebEnv} from "./web-env.js";

/** 数据宿主（`host/panel-data.ts`，L3）：推送、重取与收口。环境见 `tests/web-env.ts`。 */
const web = useWebEnv();
// 用例中途失败时也收口数据宿主的单例（关推送、取消重连），不连累同一文件里后面的用例。
const scopes: EffectScope[] = [];
/** 用例里建的 scope 都登记在这里，结束时（失败也）停掉，免得遗留的资源在后面的用例里继续取数。 */
function effectScope(): EffectScope {
    const scope = createScope();
    scopes.push(scope);
    return scope;
}
afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop();
    stopPanelData();
});

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

describe("推送触发的重取单飞（1.6）", () => {
    const revisions = (records: number) => ({records, activity: 1, sessions: 1, notify: 1, github: 1});

    test("每 30 毫秒一条推送、每次请求 80 毫秒：不中止，推送期间照样接受数据，停下后恰好补取一次、拿到最后的状态", async () => {
        let state = 0;
        web.env.respond((call) => {
            if (call.url !== "/api/overview") return undefined;
            const value = state;
            return {data: {value}, revisions: revisions(value + 1), wait: Bun.sleep(80)};
        });
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        const scope = effectScope();
        const resource = scope.run(() => useResource<{value: number}>(() => "/api/overview", ["records"]))!;
        await until(() => resource.data.value, (value) => value !== null);
        let accepted = 0;
        const stopWatch = scope.run(() => {
            let last: unknown = resource.data.value;
            return setInterval(() => {
                if (resource.data.value !== last) {
                    last = resource.data.value;
                    accepted += 1;
                }
            }, 1);
        })!;
        for (let tick = 0; tick < 20; tick += 1) {
            state += 1;
            socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: revisions(state + 1)});
            await Bun.sleep(30);
        }
        const duringPushes = accepted;
        const callsAtStop = web.env.calls.length;
        await Bun.sleep(250);
        clearInterval(stopWatch);
        expect(web.env.calls.filter((call) => call.aborted()).length).toBe(0);
        expect(duringPushes).toBeGreaterThanOrEqual(3);
        expect(web.env.calls.length - callsAtStop).toBeLessThanOrEqual(1);
        expect(resource.data.value).toEqual({value: state});
        scope.stop();
        stopPanelData();
    });

    test("在途时 reload()：中止旧请求、旧回包不写进 data", async () => {
        const hold = (async () => {})();
        let first = true;
        const gateOld = Promise.withResolvers<void>();
        web.env.respond((call) => {
            if (call.url !== "/api/overview") return undefined;
            if (first) {
                first = false;
                return {data: {value: "旧"}, wait: gateOld.promise};
            }
            return {data: {value: "新"}, wait: hold};
        });
        const scope = effectScope();
        const resource = scope.run(() => useResource<{value: string}>(() => "/api/overview", ["records"]))!;
        await until(() => web.env.calls.length, (count) => count === 1);
        resource.reload();
        await until(() => resource.data.value, (value) => value !== null);
        gateOld.resolve();
        await Bun.sleep(10);
        expect([web.env.calls[0]!.aborted(), resource.data.value]).toEqual([true, {value: "新"}]);
        scope.stop();
        stopPanelData();
    });

    test("path 变了：中止旧地址、立即取新地址，旧回包不写、之后不补取旧地址", async () => {
        const gateOld = Promise.withResolvers<void>();
        web.env.respond((call) => (call.url === "/api/work/a" ? {data: {id: "a"}, wait: gateOld.promise} : call.url === "/api/work/b" ? {data: {id: "b"}} : undefined));
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        const id = ref("a");
        const scope = effectScope();
        const resource = scope.run(() => useResource<{id: string}>(() => `/api/work/${id.value}`, ["records"]))!;
        await until(() => web.env.calls.length, (count) => count === 1);
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: revisions(9)});
        id.value = "b";
        await until(() => resource.data.value, (value) => value !== null);
        gateOld.resolve();
        await Bun.sleep(20);
        expect([resource.data.value, web.env.calls.map((call) => call.url)]).toEqual([{id: "b"}, ["/api/work/a", "/api/work/b"]]);
        scope.stop();
        stopPanelData();
    });

    test("在途请求失败、期间有推送：照样补取一次", async () => {
        let calls = 0;
        web.env.respond((call) => {
            if (call.url !== "/api/overview") return undefined;
            calls += 1;
            return calls === 2 ? {status: 503, wait: Bun.sleep(40)} : {data: {n: calls}};
        });
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        const scope = effectScope();
        const resource = scope.run(() => useResource<{n: number}>(() => "/api/overview", ["records"]))!;
        await until(() => resource.data.value, (value) => value !== null);
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: revisions(3)});
        await Bun.sleep(5);
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: revisions(4)});
        await until(() => resource.data.value, (value) => value?.n === 3);
        expect(calls).toBe(3);
        scope.stop();
        stopPanelData();
    });

    test("单飞在途时面板重启（hello 的实例变了）：旧实例的回包被接受，随后补取拿到新实例的数据", async () => {
        const gateOld = Promise.withResolvers<void>();
        let calls = 0;
        web.env.respond((call) => {
            if (call.url !== "/api/overview") return undefined;
            calls += 1;
            if (calls === 1) return {data: {from: "i1"}};
            if (calls === 2) return {data: {from: "i1-late"}, instance: "i1", wait: gateOld.promise};
            return {data: {from: "i2"}, instance: "i2", revisions: revisions(1)};
        });
        startPanelData();
        const socket = web.env.sockets()[0]!;
        socket.open();
        socket.push({type: "hello", instance: "i1", revisions: revisions(1)});
        const scope = effectScope();
        const resource = scope.run(() => useResource<{from: string}>(() => "/api/overview", ["records"]))!;
        await until(() => resource.data.value, (value) => value !== null);
        socket.push({type: "changed", instance: "i1", parts: ["records"], revisions: revisions(2)});
        await until(() => calls, (count) => count === 2);
        socket.push({type: "hello", instance: "i2", revisions: revisions(1)});
        gateOld.resolve();
        await until(() => resource.data.value, (value) => value?.from === "i2");
        expect(calls).toBe(3);
        scope.stop();
        stopPanelData();
    });
});

describe("已有数据时重取失败（1.7）", () => {
    test("先成功、再 503：保留数据，stale 为真，receivedAt 仍是第一次的时刻；再成功：stale 为假、receivedAt 更新", async () => {
        let calls = 0;
        web.env.respond((call) => {
            if (call.url !== "/api/work/a") return undefined;
            calls += 1;
            return calls === 2 ? {status: 503, errors: [{code: "unavailable", message: "后台忙"}]} : {data: {n: calls}};
        });
        const scope = effectScope();
        const resource = scope.run(() => useResource<{n: number}>(() => "/api/work/a", ["records"]))!;
        await until(() => resource.data.value, (value) => value !== null);
        const first = resource.receivedAt.value;
        expect([resource.stale.value, typeof first]).toEqual([false, "string"]);
        await Bun.sleep(5);
        resource.reload();
        await until(() => resource.error.value, (value) => value !== null);
        expect([resource.data.value, resource.error.value?.status, resource.stale.value, resource.receivedAt.value]).toEqual([{n: 1}, 503, true, first]);
        resource.reload();
        await until(() => resource.data.value, (value) => value?.n === 3);
        expect([resource.stale.value, resource.error.value]).toEqual([false, null]);
        expect(resource.receivedAt.value! > first!).toBe(true);
    });

    test("首次就失败：没有数据，stale 为假（由 LoadState 处理）", async () => {
        web.env.respond((call) => (call.url === "/api/work/a" ? {status: 404, errors: [{code: "not_found", message: "没有这个 Work"}]} : undefined));
        const scope = effectScope();
        const resource = scope.run(() => useResource<{n: number}>(() => "/api/work/a", ["records"]))!;
        await until(() => resource.error.value, (value) => value !== null);
        expect([resource.data.value, resource.error.value?.status, resource.stale.value, resource.receivedAt.value]).toEqual([null, 404, false, null]);
    });
});
