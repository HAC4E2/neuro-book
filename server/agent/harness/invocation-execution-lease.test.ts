import {randomUUID} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    HarnessInvocationExecutionLeaseStore,
    type InvocationExecutionLease,
} from "nbook/server/agent/harness/invocation-execution-lease";

describe("HarnessInvocationExecutionLeaseStore", () => {
    let root: string;
    let now: number;
    let store: HarnessInvocationExecutionLeaseStore;

    beforeEach(() => {
        root = resolve(".agent", "invocation-execution-lease-test", randomUUID());
        now = Date.parse("2026-07-30T00:00:00.000Z");
        store = new HarnessInvocationExecutionLeaseStore(root, {
            now: () => now,
            ownerId: () => "owner-a",
            leaseDurationMs: 1_000,
        });
    });

    afterEach(async () => {
        await rm(root, {recursive: true, force: true});
    });

    it("首次健康检查初始化 stable lock target、sentinel 与空 strict v1 store", async () => {
        await store.ensureHealthy();

        const persisted = JSON.parse(await readFile(
            join(root, ".nbook", "agent", "invocation-execution.json"),
            "utf8",
        )) as object;
        expect(persisted).toEqual({
            version: 1,
            nextFence: 1,
            providerStartedFences: [],
            records: [],
        });
        await expect(readFile(
            join(root, ".nbook", "agent", "invocation-execution.lock-target", "initialized"),
            "utf8",
        )).resolves.toBe("1\n");
    });

    it("lease 未过期时 active，过期后原子 fencing 为 orphaned", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 7,
            invocationId: "invocation-7",
            clientMessageId: "client-7",
        }, async () => undefined);

        await expect(store.resolve({
            sessionId: 7,
            clientMessageId: "client-7",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-7",
            executionLeaseEstablished: true,
        }))).resolves.toMatchObject({
            state: "active",
            invocationId: "invocation-7",
            lifecycle: "accepted",
        });

        now += 1_001;
        await expect(store.resolve({
            sessionId: 7,
            clientMessageId: "client-7",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-7",
            executionLeaseEstablished: true,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-7",
            providerStartRecorded: false,
        });
        await expect(store.withLiveExecutionFence(lease, async () => true)).resolves.toEqual({
            committed: false,
        });
    });

    it("reader 赢得 admission gap 后持久化 orphan fence，迟到的 owner 不能再建立 lease", async () => {
        await store.ensureHealthy();

        await expect(store.resolve({
            sessionId: 10,
            clientMessageId: "client-10",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-10",
            executionLeaseEstablished: false,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-10",
            providerStartRecorded: false,
        });

        await expect(store.establish({
            sessionId: 10,
            invocationId: "invocation-10",
            clientMessageId: "client-10",
        }, async () => undefined)).rejects.toThrow("execution lease identity 已存在");
    });

    it("initialized 后 missing、malformed 与 unknown-version store 都不会被自动重建", async () => {
        const cases = [
            {
                name: "missing",
                tamper: async (path: string) => rm(path, {force: true}),
                expected: null,
            },
            {
                name: "malformed",
                tamper: async (path: string) => writeFile(path, "{broken", "utf8"),
                expected: "{broken",
            },
            {
                name: "unknown-version",
                tamper: async (path: string) => writeFile(path, "{\"version\":2}\n", "utf8"),
                expected: "{\"version\":2}\n",
            },
        ] as const;

        for (const testCase of cases) {
            const caseRoot = join(root, testCase.name);
            const caseStore = new HarnessInvocationExecutionLeaseStore(caseRoot);
            const path = join(caseRoot, ".nbook", "agent", "invocation-execution.json");
            await caseStore.ensureHealthy();
            await testCase.tamper(path);

            await expect(caseStore.ensureHealthy()).rejects.toMatchObject({
                code: "execution_evidence_lost",
            });
            if (testCase.expected === null) {
                await expect(readFile(path, "utf8")).rejects.toMatchObject({code: "ENOENT"});
            } else {
                await expect(readFile(path, "utf8")).resolves.toBe(testCase.expected);
            }
        }
    });

    it("corrupt sidecar never overwrites terminal Session truth or the corrupt bytes", async () => {
        await store.ensureHealthy();
        await store.establish({
            sessionId: 11,
            invocationId: "invocation-11",
            clientMessageId: "client-11",
        }, async () => undefined);
        const path = join(root, ".nbook", "agent", "invocation-execution.json");
        const corruptBytes = "{\"version\":2,\"records\":\"lost\"}\n";
        await writeFile(path, corruptBytes, "utf8");

        await expect(store.resolve({
            sessionId: 11,
            clientMessageId: "client-11",
        }, async () => ({state: "terminal"}))).resolves.toEqual({state: "terminal"});
        await expect(readFile(path, "utf8")).resolves.toBe(corruptBytes);
    });

    it("missing exact record after execution marker is conservative null and leaves the store untouched", async () => {
        await store.ensureHealthy();
        const path = join(root, ".nbook", "agent", "invocation-execution.json");
        const before = await readFile(path, "utf8");

        await expect(store.resolve({
            sessionId: 12,
            clientMessageId: "client-12",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-12",
            executionLeaseEstablished: true,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-12",
            providerStartRecorded: null,
        });
        await expect(readFile(path, "utf8")).resolves.toBe(before);
    });

    it("Provider start fence survives expiry and terminal commit prunes the exact live record", async () => {
        await store.ensureHealthy();
        const lease: InvocationExecutionLease = await store.establish({
            sessionId: 8,
            invocationId: "invocation-8",
            clientMessageId: "client-8",
        }, async () => undefined);
        await store.recordProviderStarted(lease);

        await expect(store.resolve({
            sessionId: 8,
            clientMessageId: "client-8",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-8",
            executionLeaseEstablished: true,
        }))).resolves.toMatchObject({
            state: "active",
            lifecycle: "running",
        });
        await expect(store.withLiveExecutionFence(lease, async () => "terminal")).resolves.toEqual({
            committed: true,
            value: "terminal",
        });
        await expect(store.resolve({
            sessionId: 8,
            clientMessageId: "client-8",
        }, async () => ({state: "terminal"}))).resolves.toEqual({state: "terminal"});
    });

    it("deleting providerStartedAt after the start fence degrades to null, never false", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 9,
            invocationId: "invocation-9",
            clientMessageId: "client-9",
        }, async () => undefined);
        await store.recordProviderStarted(lease);
        const path = join(root, ".nbook", "agent", "invocation-execution.json");
        const persisted = JSON.parse(await readFile(path, "utf8")) as {
            records: Array<{providerStartedAt?: string}>;
        };
        delete persisted.records[0]?.providerStartedAt;
        await writeFile(path, `${JSON.stringify(persisted)}\n`, "utf8");

        now += 1_001;
        await expect(store.resolve({
            sessionId: 9,
            clientMessageId: "client-9",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-9",
            executionLeaseEstablished: true,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-9",
            providerStartRecorded: null,
        });
    });

    it("terminal commit winning the execution lock makes an orphan reader wait for terminal truth", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 13,
            invocationId: "invocation-13",
            clientMessageId: "client-13",
        }, async () => undefined);
        let releaseCommit!: () => void;
        const commitGate = new Promise<void>((resolveGate) => {
            releaseCommit = resolveGate;
        });
        let commitEntered!: () => void;
        const commitEnteredPromise = new Promise<void>((resolveEntered) => {
            commitEntered = resolveEntered;
        });
        let terminal = false;
        const terminalCommit = store.withLiveExecutionFence(lease, async () => {
            commitEntered();
            await commitGate;
            terminal = true;
            return "terminal";
        });
        await commitEnteredPromise;
        const resolution = store.resolve({
            sessionId: 13,
            clientMessageId: "client-13",
        }, async () => terminal
            ? {state: "terminal"}
            : {
                state: "nonterminal",
                invocationId: "invocation-13",
                executionLeaseEstablished: true,
            });
        releaseCommit();

        await expect(terminalCommit).resolves.toEqual({committed: true, value: "terminal"});
        await expect(resolution).resolves.toEqual({state: "terminal"});
    });

    it("orphan fencing winning the execution lock rejects every late terminal callback", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 14,
            invocationId: "invocation-14",
            clientMessageId: "client-14",
        }, async () => undefined);
        now += 1_001;
        let releaseSessionRead!: () => void;
        const sessionReadGate = new Promise<void>((resolveGate) => {
            releaseSessionRead = resolveGate;
        });
        let sessionReadEntered!: () => void;
        const sessionReadEnteredPromise = new Promise<void>((resolveEntered) => {
            sessionReadEntered = resolveEntered;
        });
        const resolution = store.resolve({
            sessionId: 14,
            clientMessageId: "client-14",
        }, async () => {
            sessionReadEntered();
            await sessionReadGate;
            return {
                state: "nonterminal",
                invocationId: "invocation-14",
                executionLeaseEstablished: true,
            };
        });
        await sessionReadEnteredPromise;
        let terminalCallbacks = 0;
        const terminalCommit = store.withLiveExecutionFence(lease, async () => {
            terminalCallbacks += 1;
            return "must-not-commit";
        });
        releaseSessionRead();

        await expect(resolution).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-14",
            providerStartRecorded: false,
        });
        await expect(terminalCommit).resolves.toEqual({committed: false});
        expect(terminalCallbacks).toBe(0);
    });

    it("Session terminal append surviving a crash is returned and prunes its stale sidecar", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 15,
            invocationId: "invocation-15",
            clientMessageId: "client-15",
        }, async () => undefined);
        let terminal = false;
        await expect(store.withLiveExecutionFence(lease, async () => {
            terminal = true;
            throw new Error("simulated process crash before sidecar prune");
        })).rejects.toThrow("simulated process crash");

        await expect(store.resolve({
            sessionId: 15,
            clientMessageId: "client-15",
        }, async () => terminal
            ? {state: "terminal"}
            : {
                state: "nonterminal",
                invocationId: "invocation-15",
                executionLeaseEstablished: true,
            })).resolves.toEqual({state: "terminal"});
        const persisted = JSON.parse(await readFile(
            join(root, ".nbook", "agent", "invocation-execution.json"),
            "utf8",
        )) as {records: object[]};
        expect(persisted.records).toEqual([]);
    });
});
