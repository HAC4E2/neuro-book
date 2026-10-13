import {afterEach, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createHerdrClient, HERDR_PANEL_METHODS, HERDR_PANEL_READ_METHODS} from "../src/herdr/client.js";
import {checkDeliverable, deliverKeys, deliverText, type DeliveryContext} from "../src/server/delivery.js";
import {claudePane, startFakeHerdr, type FakeHerdr, type FakePane} from "./fake-herdr.js";

/** t11 投递（L3，假 herdr）：判定的每一种拒绝、紧贴投递的复核、投递后的核对、白名单。 */

const REPO = "/repo/main";
const SESSION = "11111111-1111-4111-8111-111111111111";
const KEY = `claude:${SESSION}`;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const close of closers.splice(0)) await close();
});

async function setup(extra: Partial<FakePane> = {}): Promise<{fake: FakeHerdr; context: DeliveryContext; pane: FakePane; slept: number[]}> {
    const root = await createTestTmpRoot("dev-panel-delivery", "dev-panel delivery");
    closers.push(() => rm(root, {recursive: true, force: true}));
    const pane = claudePane("w9:p1", SESSION, {cwd: REPO, foreground_cwd: REPO, state_change_seq: 5, ...extra});
    const fake = await startFakeHerdr(root, [pane]);
    closers.push(() => fake.close());
    const slept: number[] = [];
    const context: DeliveryContext = {client: createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_METHODS}), repoRoots: [REPO], sleep: async (ms) => {
        slept.push(ms);
    }};
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

    test("回车前后弹出确认界面（还在等确认，或状态序号跳了两格以上）：delivered_into_blocked；投递的瞬间换了会话：delivered_maybe_wrong_session；herdr 没看到开始工作：uncertain；正常一格：delivered", async () => {
        for (const [behavior, expected] of [["blocked_after", "delivered_into_blocked"], ["blocked_then_working", "delivered_into_blocked"], ["switch_session", "delivered_maybe_wrong_session"], ["stall", "uncertain"], ["working", "delivered"]] as const) {
            const {context} = await setup({on_prompt: behavior});
            const checked = await checkDeliverable(context, target);
            const outcome = await deliverText(context, target, "x", checked.ok ? checked.agent : (null as never));
            expect([behavior, outcome.result]).toEqual([behavior, expected]);
        }
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

describe("白名单（场景 6）", () => {
    test("面板的名单里没有 pane.run、server.stop 等；不在名单里的方法在客户端就被拒绝，不到达 herdr", async () => {
        for (const method of ["pane.run", "pane.send_text", "pane.send_input", "server.stop", "pane.report_metadata", "workspace.create"]) expect([method, HERDR_PANEL_METHODS.includes(method)]).toEqual([method, false]);
        expect([...HERDR_PANEL_METHODS].sort()).toEqual(["agent.explain", "agent.get", "agent.prompt", "agent.read", "agent.send_keys", "events.subscribe", "pane.list", "pane.process_info", "ping", "session.snapshot"]);
        const {fake} = await setup();
        const readOnly = createHerdrClient({socketPath: fake.socketPath, allow: HERDR_PANEL_READ_METHODS});
        await expect(readOnly.agentPrompt("w9:p1", "x", {until: ["working"], timeoutMs: 1_000})).rejects.toMatchObject({code: "method_not_allowed"});
        await expect(readOnly.agentSendKeys("w9:p1", ["enter"])).rejects.toMatchObject({code: "method_not_allowed"});
        expect(fake.requests).toEqual([]);
    });
});
