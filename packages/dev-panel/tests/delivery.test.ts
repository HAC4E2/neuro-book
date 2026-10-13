import {afterEach, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createHerdrClient, HERDR_PANEL_METHODS, HERDR_PANEL_READ_METHODS} from "../src/herdr/client.js";
import {checkDeliverable, deliverKeys, deliverText, type DeliveryContext} from "../src/server/delivery.js";
import {DEFAULT_HERDR_TIMINGS, HerdrMonitor} from "../src/server/herdr-monitor.js";
import {claudePane, startFakeHerdr, type FakeHerdr, type FakePane} from "./fake-herdr.js";

/** t11 投递（L3，假 herdr）：判定的每一种拒绝、紧贴投递的复核、投递后的核对（面板的订阅看投递窗口里的状态事件）、白名单。 */

const REPO = "/repo/main";
const SESSION = "11111111-1111-4111-8111-111111111111";
const KEY = `claude:${SESSION}`;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
});

/**
 * `watched`：起一个面板的 herdr 监视、等订阅连上，投递时用它看状态事件（缺省）；为假时不给，走“没订阅到”的退路。
 * 第二格 `w9:p2` 是另一个会话，用来在投递窗口里推高全局的状态序号。
 */
async function setup(extra: Partial<FakePane> = {}, options: {watched?: boolean} = {}): Promise<{fake: FakeHerdr; context: DeliveryContext; pane: FakePane; slept: number[]}> {
    const root = await createTestTmpRoot("dev-panel-delivery", "dev-panel delivery");
    closers.push(() => rm(root, {recursive: true, force: true}));
    const pane = claudePane("w9:p1", SESSION, {cwd: REPO, foreground_cwd: REPO, state_change_seq: 5, ...extra});
    const fake = await startFakeHerdr(root, [pane, claudePane("w9:p2", "22222222-2222-4222-8222-222222222222", {cwd: REPO, state_change_seq: 3})]);
    closers.push(() => fake.close());
    const slept: number[] = [];
    // 投递后的等待要真的让出一会儿：状态事件走另一条连接，要在复读之前到达。
    const context: DeliveryContext = {client: createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_METHODS}), repoRoots: [REPO], sleep: async (ms) => {
        slept.push(ms);
        await Bun.sleep(Math.min(ms, 50));
    }};
    if (options.watched !== false) {
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}), () => undefined, () => undefined);
        closers.push(async () => monitor.stop());
        monitor.start();
        while (monitor.current().mode !== "subscribed") await Bun.sleep(10);
        context.watchStatus = (paneId) => monitor.watchStatus(paneId);
    }
    return {fake, context, pane, slept};
}
const target = {paneId: "w9:p1", sessionKey: KEY};

describe("投递前的判定", () => {
    test("空输入框、空闲、在本仓库：可投，投递之后进入工作，记 delivered", async () => {
        const {fake, context} = await setup();
        const checked = await checkDeliverable(context, target);
        expect(checked.ok).toBe(true);
        const outcome = await deliverText(context, target, "[nbdev] 测试", checked.ok ? checked.agent : (null as never));
        expect([outcome.result, fake.prompts]).toEqual(["delivered", [{target: "w9:p1", text: "[nbdev] 测试"}]]);
    });

    test("每一种不可投：换了会话、不在本仓库、在工作、在等确认、状态未知、认不出的界面、输入框有字、清单里没有规则；都不发", async () => {
        const cases: Array<[string, Partial<FakePane>, string]> = [
            ["换了会话", {agent_session: {agent: "claude", kind: "id", source: "herdr:claude", value: "22222222-2222-4222-8222-222222222222"}}, "session_changed"],
            ["不在本仓库", {cwd: "/elsewhere", foreground_cwd: "/elsewhere"}, "not_in_repository"],
            ["在工作", {agent_status: "working"}, "agent_busy"],
            ["在等确认", {agent_status: "blocked"}, "agent_blocked"],
            ["状态未知", {agent_status: "unknown"}, "status_unknown"],
            ["认不出的确认界面", {explain: {matched: null, fallback: "default_known_agent_idle_fallback", preview: ""}}, "not_deliverable"],
            ["详细记录视图", {explain: {matched: "transcript_viewer", fallback: null, preview: ""}}, "not_deliverable"],
            ["输入框有字", {explain: {matched: "live_prompt_box", fallback: null, preview: "❯ 半截字\n"}, visible: "──────────────────────────────\n❯ 半截字\n──────────────────────────────\n"}, "not_deliverable"],
            ["清单里没有规则", {explain: {matched: "live_prompt_box", fallback: null}}, "not_deliverable"],
        ];
        for (const [name, extra, code] of cases) {
            const {fake, context} = await setup(extra);
            const checked = await checkDeliverable(context, target);
            expect([name, checked.ok ? "ok" : checked.code]).toEqual([name, code]);
            expect([name, fake.prompts.length]).toEqual([name, 0]);
            if (!checked.ok && checked.code === "not_deliverable") expect(checked.screen).not.toBeNull();
        }
    });

    test("空闲要稳定：状态序号变了（not_stable）或不足 3 秒（settling）都不投", async () => {
        const {context} = await setup();
        expect(await checkDeliverable(context, target, {stable: {seq: 4, since: 0}, now: () => 10_000})).toMatchObject({ok: false, code: "not_stable"});
        expect(await checkDeliverable(context, target, {stable: {seq: 5, since: 9_000}, now: () => 10_000})).toMatchObject({ok: false, code: "settling"});
        expect((await checkDeliverable(context, target, {stable: {seq: 5, since: 6_000}, now: () => 10_000})).ok).toBe(true);
    });

    test("聚焦的那一格隔一秒再读一次：第二次输入框里有了字就不投", async () => {
        const {context, pane, slept} = await setup({focused: true});
        context.sleep = async (ms) => {
            slept.push(ms);
            pane.explain = {matched: "live_prompt_box", fallback: null, preview: "❯ 我\n"};
            pane.visible = "──────────────────────────────\n❯ 我\n──────────────────────────────\n";
        };
        expect(await checkDeliverable(context, target)).toMatchObject({ok: false, code: "not_deliverable"});
        expect(slept).toEqual([1_000]);
    });
});

describe("投递与之后的核对", () => {
    test("判定之后状态变了：紧贴投递的复核挡住，不发", async () => {
        const {fake, context, pane} = await setup();
        const checked = await checkDeliverable(context, target);
        pane.state_change_seq = 9;
        const outcome = await deliverText(context, target, "x", checked.ok ? checked.agent : (null as never));
        expect([outcome.result, outcome.code, fake.prompts.length]).toEqual(["not_deliverable", "not_stable", 0]);
    });

    test("回车前后弹出确认界面（还在等确认，或窗口里这一格经过了 blocked）：delivered_into_blocked；投递的瞬间换了会话：delivered_maybe_wrong_session；herdr 没看到开始工作：uncertain；正常：delivered", async () => {
        const cases = [["blocked_after", "delivered_into_blocked", null], ["blocked_then_working", "delivered_into_blocked", "passed_blocked"], ["switch_session", "delivered_maybe_wrong_session", null], ["stall", "uncertain", "agent_prompt_stalled"], ["working", "delivered", null]] as const;
        for (const [behavior, result, code] of cases) {
            const {context} = await setup({on_prompt: behavior});
            const checked = await checkDeliverable(context, target);
            const outcome = await deliverText(context, target, "x", checked.ok ? checked.agent : (null as never));
            expect([behavior, outcome.result, outcome.code]).toEqual([behavior, result, code]);
        }
    });

    test("状态序号是全局计数：投递窗口里别的会话变了两次状态、这一格只是进入工作，记 delivered，不误报（t11 的通知误报）", async () => {
        const {fake, context} = await setup();
        const checked = await checkDeliverable(context, target);
        const before = checked.ok ? checked.agent : (null as never);
        fake.duringPrompt = () => {
            fake.setStatus("w9:p2", "working");
            fake.setStatus("w9:p2", "idle");
        };
        const outcome = await deliverText(context, target, "x", before);
        // 旧的判据（序号差值大于等于 2）在这里会报 delivered_into_blocked。
        expect(outcome.agent!.stateChangeSeq! - before.stateChangeSeq!).toBeGreaterThanOrEqual(2);
        expect([outcome.result, outcome.code]).toEqual(["delivered", null]);
    });

    test("别的会话变状态的同时这一格确实经过了 blocked：照样报 passed_blocked", async () => {
        const {fake, context} = await setup({on_prompt: "blocked_then_working"});
        const checked = await checkDeliverable(context, target);
        fake.duringPrompt = () => fake.setStatus("w9:p2", "working");
        const outcome = await deliverText(context, target, "x", checked.ok ? checked.agent : (null as never));
        expect([outcome.result, outcome.code]).toEqual(["delivered_into_blocked", "passed_blocked"]);
    });

    test("返回体里是 blocked（粘贴时弹出确认、之后回车确认了它）：没有订阅也报 passed_blocked（不靠事件）", async () => {
        const {context} = await setup({on_prompt: "blocked_in_reply"}, {watched: false});
        const checked = await checkDeliverable(context, target);
        const outcome = await deliverText(context, target, "x", checked.ok ? checked.agent : (null as never));
        expect([outcome.result, outcome.code, outcome.agent?.status]).toEqual(["delivered_into_blocked", "passed_blocked", "working"]);
    });

    test("投递窗口里换了订阅连接：还订着的这一格记 delivered、code null；被去掉的那一格记 unwatched", async () => {
        const SESSION_2 = "22222222-2222-4222-8222-222222222222";
        for (const [who, expected] of [["w9:p1", {result: "delivered", code: null}], ["w9:p2", {result: "delivered", code: "unwatched"}]] as const) {
            const {fake, context} = await setup();
            const subscribes = () => fake.requests.filter((request) => request.method === "events.subscribe").length;
            const before = subscribes();
            // 窗口里 w9:p2 不再是 Agent：面板对账后换一条只订 w9:p1 的连接。
            fake.duringPrompt = () => {
                fake.panes[1]!.agent = null;
                fake.emit("pane.updated", {pane_id: "w9:p2"});
            };
            // 等换线完成（新连接回了 subscription_started、旧的关掉）再做投递后的核对。
            context.sleep = async () => {
                for (let waited = 0; !(subscribes() > before && fake.subscriberCount() === 1); waited += 20) {
                    if (waited > 3_000) throw new Error("3 秒内没有换订阅连接");
                    await Bun.sleep(20);
                }
                await Bun.sleep(50);
            };
            const goal = who === "w9:p1" ? target : {paneId: "w9:p2", sessionKey: `claude:${SESSION_2}`};
            const checked = await checkDeliverable(context, goal);
            const outcome = await deliverText(context, goal, "x", checked.ok ? checked.agent : (null as never));
            expect([who, outcome.result, outcome.code]).toEqual([who, expected.result, expected.code]);
        }
    });

    test("退路：没有订阅、或投递窗口里订阅断了，记 delivered 加 unwatched；最后还停在 blocked 的照样报（不靠事件）", async () => {
        const plain = await setup({}, {watched: false});
        const checked = await checkDeliverable(plain.context, target);
        expect(await deliverText(plain.context, target, "x", checked.ok ? checked.agent : (null as never))).toMatchObject({result: "delivered", code: "unwatched"});

        const dropped = await setup();
        const again = await checkDeliverable(dropped.context, target);
        dropped.fake.duringPrompt = () => dropped.fake.dropSubscribers();
        expect(await deliverText(dropped.context, target, "x", again.ok ? again.agent : (null as never))).toMatchObject({result: "delivered", code: "unwatched"});

        const stuck = await setup({on_prompt: "blocked_after"}, {watched: false});
        const third = await checkDeliverable(stuck.context, target);
        expect(await deliverText(stuck.context, target, "x", third.ok ? third.agent : (null as never))).toMatchObject({result: "delivered_into_blocked", code: null});
    });

    test("按键：只核身份与仓库，在等确认时也能发", async () => {
        const {fake, context} = await setup({agent_status: "blocked"});
        expect((await deliverKeys(context, target, ["esc"])).ok).toBe(true);
        expect(fake.keys).toEqual([{target: "w9:p1", keys: ["esc"]}]);
        const moved = await setup({cwd: "/elsewhere", foreground_cwd: "/elsewhere"});
        expect(await deliverKeys(moved.context, target, ["enter"])).toMatchObject({ok: false, code: "not_in_repository"});
        expect(moved.fake.keys).toEqual([]);
    });
});

describe("面板订阅的观察（watchStatus）", () => {
    test("订阅没连上（轮询中）、新 pane 还没换连接时回 null；连上、换上之后才给", async () => {
        const root = await createTestTmpRoot("dev-panel-watch", "dev-panel watchStatus");
        closers.push(() => rm(root, {recursive: true, force: true}));
        const fake = await startFakeHerdr(root, [claudePane("w9:p1", SESSION, {cwd: REPO, state_change_seq: 1})]);
        closers.push(() => fake.close());
        fake.overrides["events.subscribe"] = {code: "nope", message: "拒绝订阅"};
        const monitor = new HerdrMonitor(createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS}), () => undefined, () => undefined, {...DEFAULT_HERDR_TIMINGS, reconcileMs: 200});
        closers.push(async () => monitor.stop());
        monitor.start();
        for (let waited = 0; !(monitor.current().available && monitor.current().mode === "polling"); waited += 10) {
            if (waited > 3_000) throw new Error(`3 秒内没进轮询：${JSON.stringify(monitor.current())}`);
            await Bun.sleep(10);
        }
        expect(monitor.watchStatus("w9:p1")).toBeNull();
        delete fake.overrides["events.subscribe"];
        for (let waited = 0; monitor.current().mode !== "subscribed"; waited += 10) {
            if (waited > 3_000) throw new Error("3 秒内没订上");
            await Bun.sleep(10);
        }
        const first = monitor.watchStatus("w9:p1");
        expect(first).not.toBeNull();
        first!.close();
        fake.panes.push(claudePane("w9:p3", "33333333-3333-4333-8333-333333333333", {cwd: REPO, state_change_seq: 2}));
        expect(monitor.watchStatus("w9:p3")).toBeNull();
        fake.emit("pane.created", {pane_id: "w9:p3"});
        for (let waited = 0; ; waited += 10) {
            const watch = monitor.watchStatus("w9:p3");
            if (watch) {
                watch.close();
                break;
            }
            if (waited > 3_000) throw new Error("3 秒内新 pane 没订上");
            await Bun.sleep(10);
        }
    });
});

describe("白名单（场景 6）", () => {
    test("面板的名单里没有 pane.run、server.stop 等；不在名单里的方法在客户端就被拒绝，不到达 herdr", async () => {
        for (const method of ["pane.run", "pane.send_text", "pane.send_input", "server.stop", "pane.report_metadata", "workspace.create"]) expect([method, HERDR_PANEL_METHODS.includes(method)]).toEqual([method, false]);
        expect([...HERDR_PANEL_METHODS].sort()).toEqual(["agent.explain", "agent.get", "agent.prompt", "agent.read", "agent.send_keys", "events.subscribe", "pane.list", "pane.process_info", "ping", "session.snapshot"]);
        const {fake} = await setup({}, {watched: false});
        const readOnly = createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS});
        await expect(readOnly.agentPrompt("w9:p1", "x", {until: ["working"], timeoutMs: 1_000})).rejects.toMatchObject({code: "method_not_allowed"});
        await expect(readOnly.agentSendKeys("w9:p1", ["enter"])).rejects.toMatchObject({code: "method_not_allowed"});
        expect(fake.requests).toEqual([]);
    });
});
