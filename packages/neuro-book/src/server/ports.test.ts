/** 端口成组顺延（docs/specs/runtime/server-host.md 的“输入与前置条件”与开发模式）：真实监听，占住一个端口看整组是否顺延。 */

import {describe, expect, it} from "bun:test";

import {freeGroupOffset, PORT_SHIFT_STEP, probePort} from "./ports";

const HOST = "127.0.0.1";

/** 找一组此刻空闲的端口：基址、基址加一，以及两者顺延一步后的端口都空闲，断言才站得住。 */
async function freeBase(): Promise<number> {
    for (let round = 0; round < 50; round++) {
        const probe = Bun.serve({hostname: HOST, port: 0, fetch: () => new Response(null, {status: 404})});
        const base = probe.port as number;
        await probe.stop(true);
        try {
            for (const port of [base, base + 1, base + PORT_SHIFT_STEP, base + 1 + PORT_SHIFT_STEP]) await probePort(HOST, port);
            return base;
        } catch {
            // 这一组里有被占的，换一组。
        }
    }
    throw new Error("找不到空闲的端口组");
}

describe("端口成组顺延", () => {
    it("组里任一端口被占用时整组加 100；都空闲时偏移为 0；试探过的端口随即可用", async () => {
        const base = await freeBase();
        const occupied = Bun.serve({hostname: HOST, port: base + 1, fetch: () => new Response(null, {status: 404})});
        try {
            expect(await freeGroupOffset(HOST, [base, base + 1])).toBe(PORT_SHIFT_STEP);
            expect(await freeGroupOffset(HOST, [base])).toBe(0);
            const taken = Bun.serve({hostname: HOST, port: base, fetch: () => new Response(null, {status: 404})});
            await taken.stop(true);
        } finally {
            await occupied.stop(true);
        }
    });
});
