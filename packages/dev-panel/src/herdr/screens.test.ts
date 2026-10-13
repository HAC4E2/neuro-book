import {describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import type {HerdrExplain} from "./client.js";
import {judgeDeliverable} from "./screens.js";

/** L1：投递的正向判据，样本来自 S0（真实 claude 2.1.296 与 omp，没有模型调用）与设计审查的假 TUI。 */
type Sample = {name: string; source: string; agent: string; expect: boolean; explain: HerdrExplain; visibleAnsi: string};
const {samples} = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../tests/fixtures/screens.json"), "utf8")) as {samples: Sample[]};

describe("能不能往输入框里投", () => {
    for (const sample of samples) {
        test(`${sample.name}（${sample.source}）：${sample.expect ? "可投" : "不可投"}`, () => {
            const verdict = judgeDeliverable({agent: sample.agent, explain: sample.explain, visibleAnsi: sample.visibleAnsi});
            expect([sample.name, verdict.ok]).toEqual([sample.name, sample.expect]);
        });
    }

    test("没取样过的 Agent 一律不可投", () => {
        expect(judgeDeliverable({agent: "codex", explain: null, visibleAnsi: "❯ \n"})).toMatchObject({ok: false, reason: "agent_unsupported"});
    });

    test("占位文字只在暗色时算空：同样的文字不暗就是开发者打的字", () => {
        const sample = samples.find((entry) => entry.name === "claude-placeholder")!;
        const undimmed = sample.visibleAnsi.replace("\u001b[2m", "");
        expect(judgeDeliverable({agent: "claude", explain: sample.explain, visibleAnsi: undimmed})).toMatchObject({ok: false, reason: "input_not_empty"});
    });
});
