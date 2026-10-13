import {describe, expect, test} from "bun:test";
import {attemptNeedsAttention} from "../src/web/host/format.js";

/** 通知尝试要不要醒目（L1）：会话页、产物页的状态行与左栏的计数共用这一条判据。 */
describe("attemptNeedsAttention", () => {
    test("投递途中退出、投进了确认界面、换了会话、结果未知要醒目；旧判据的 state_jumped、没核对确认界面的 delivered 不算", () => {
        const of = (result: string, code: string | null = null, intentOnly = false) => attemptNeedsAttention({result: result as never, code, intentOnly});
        expect([
            of("pending", null, true),
            of("delivered_into_blocked"),
            of("delivered_into_blocked", "passed_blocked"),
            of("delivered_maybe_wrong_session"),
            of("uncertain", "agent_prompt_stalled"),
        ]).toEqual([true, true, true, true, true]);
        expect([of("delivered_into_blocked", "state_jumped"), of("delivered", "unwatched"), of("delivered"), of("skipped"), of("not_deliverable", "not_stable")]).toEqual([false, false, false, false, false]);
    });
});
