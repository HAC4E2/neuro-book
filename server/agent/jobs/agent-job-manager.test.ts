import {readFile, rm} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {AgentJobManager} from "nbook/server/agent/jobs/agent-job-manager";

describe("AgentJobManager", () => {
    it("结果回流使用普通 prompt invocation，且 waitIdle 等到投递完成", async () => {
        let releaseDelivery: (() => void) | undefined;
        const delivery = new Promise<void>((resolve) => {
            releaseDelivery = resolve;
        });
        const invokeAgent = vi.fn(async () => {
            await delivery;
            return {
                sessionId: 7,
                invocationId: "job-followup",
                status: "completed" as const,
                finalMessage: "received",
            };
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
        jobs.spawn({
            kind: "bash",
            title: "background task",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });

        let idleResolved = false;
        const idle = jobs.waitIdle().then(() => {
            idleResolved = true;
        });
        await vi.waitFor(() => expect(invokeAgent).toHaveBeenCalledOnce());

        expect(idleResolved).toBe(false);
        expect(invokeAgent).toHaveBeenCalledWith({
            sessionId: 7,
            mode: "prompt",
            message: {text: "<system-reminder>\n[后台任务完成] background task（" + jobs.list()[0]!.jobId + "）\ndone\n</system-reminder>"},
            caller: {kind: "system"},
            signal: expect.any(AbortSignal),
        });

        releaseDelivery!();
        await idle;
        expect(idleResolved).toBe(true);
    });

    it("shutdown 会取消在途结果回流，不被不合作的 owner invocation 永久阻塞", async () => {
        const invokeAgent = vi.fn(async (input: {signal?: AbortSignal}) => {
            await new Promise<void>((resolve) => {
                if (input.signal?.aborted) {
                    resolve();
                    return;
                }
                input.signal?.addEventListener("abort", () => resolve(), {once: true});
            });
            return {
                sessionId: 7,
                invocationId: "shutdown-followup",
                status: "error" as const,
            };
        });
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
        jobs.spawn({
            kind: "workflow",
            title: "shutdown delivery",
            ownerSessionId: 7,
            run: async () => ({resultPreview: "done"}),
        });
        await vi.waitFor(() => expect(invokeAgent).toHaveBeenCalledOnce());

        await expect(Promise.race([
            jobs.shutdown().then(() => "settled"),
            new Promise<string>((resolve) => setTimeout(() => resolve("timed-out"), 300)),
        ])).resolves.toBe("settled");
    });

    it("list 保持轻量，get 保存完整大型结构化结果且通知不截断", async () => {
        const invokeAgent = vi.fn(async (_input: {message: {text: string}}) => ({
            sessionId: 7,
            invocationId: "job-followup",
            status: "completed" as const,
        }));
        const jobs = new AgentJobManager(() => ({invokeAgent}) as never, "");
        const largeText = "完整结果".repeat(3_000);
        const spawned = jobs.spawn({
            kind: "workflow",
            title: "large workflow",
            ownerSessionId: 7,
            run: async () => ({
                resultPreview: largeText,
                result: {payload: largeText},
                message: `[后台 Workflow 完成]\n${JSON.stringify({payload: largeText}, null, 2)}`,
            }),
        });

        await jobs.waitIdle();
        const summary = jobs.list()[0]!;
        const detail = jobs.get(spawned.jobId)!;
        const notification = invokeAgent.mock.calls[0]![0].message.text;

        expect(summary).not.toHaveProperty("result");
        expect(summary.preview?.length).toBeLessThanOrEqual(401);
        expect(detail.result).toEqual({payload: largeText});
        expect(notification).toContain("<system-reminder>\n[后台 Workflow 完成]");
        expect(notification).not.toContain("[后台任务完成]");
        expect(notification).toContain(largeText);
        expect(notification).not.toContain("截断");
        expect(notification).not.toContain("```json");
    });

    it("jobs.jsonl 串行记录 running、waiting、running、terminal", async () => {
        const root = resolve(".agent", "agent-job-manager-test", randomUUID());
        const registryPath = resolve(root, "jobs.jsonl");
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, registryPath);
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolveGate) => {
            release = resolveGate;
        });
        jobs.spawn({
            kind: "workflow",
            title: "ordered",
            deliver: "none",
            run: async (context) => {
                context.setWaiting("wait");
                context.setRunning();
                await gate;
                return {resultPreview: "done"};
            },
        });
        release!();
        await jobs.waitIdle();

        const lines = (await readFile(registryPath, "utf8"))
            .trim()
            .split("\n")
            .map((line) => (JSON.parse(line) as {status: string}).status);
        expect(lines).toEqual(["running", "waiting", "running", "completed"]);
        await rm(root, {recursive: true, force: true});
    });

    it("clearFinished 只清终态条目，running 保留", async () => {
        const jobs = new AgentJobManager(() => {
            throw new Error("ownerless 测试不应投递");
        }, "");
        jobs.spawn({
            kind: "bash",
            title: "finished",
            deliver: "none",
            run: async () => ({resultPreview: "done"}),
        });
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolveGate) => {
            release = resolveGate;
        });
        const running = jobs.spawn({
            kind: "bash",
            title: "still running",
            deliver: "none",
            run: async () => {
                await gate;
                return {resultPreview: "done"};
            },
        });
        await vi.waitFor(() => expect(jobs.list().find((job) => job.title === "finished")?.status).toBe("completed"));

        expect(jobs.clearFinished()).toBe(1);
        expect(jobs.list().map((job) => job.jobId)).toEqual([running.jobId]);

        release!();
        await jobs.waitIdle();
    });
});
