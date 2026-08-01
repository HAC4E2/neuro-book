import {randomUUID} from "node:crypto";
import {open as openFile, readFile, readdir, rm, writeFile} from "node:fs/promises";
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
            records: [],
        });
        await expect(readFile(
            join(root, ".nbook", "agent", "invocation-execution.lock-target", "initialized"),
            "utf8",
        )).resolves.toBe("1\n");
    });

    it("sentinel 丢失时不会把 nextFence>1 的空历史 store 覆盖为初始 store", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 17,
            invocationId: "invocation-bootstrap-history",
            clientMessageId: "client-bootstrap-history",
        }, async () => undefined);
        await store.withLiveExecutionFence(lease, async () => undefined);
        const storePath = join(root, ".nbook", "agent", "invocation-execution.json");
        const sentinelPath = join(root, ".nbook", "agent", "invocation-execution.lock-target", "initialized");
        const allocationPath = join(root, ".nbook", "agent", "invocation-execution.lock-target", "fence-allocations", `${lease.fence}.json`);
        await rm(allocationPath, {force: true});
        await rm(sentinelPath, {force: true});
        const historicalStore = await readFile(storePath, "utf8");

        await expect(store.ensureHealthy()).rejects.toMatchObject({
            code: "execution_evidence_lost",
        });
        await expect(readFile(storePath, "utf8")).resolves.toBe(historicalStore);
        await expect(readFile(sentinelPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it.each(["allocation", "provider witness"] as const)(
        "sentinel 丢失且 strict 初始 store 旁仍有 %s 时在 publish 前 fail closed",
        async (evidenceKind) => {
            await store.ensureHealthy();
            const storePath = join(root, ".nbook", "agent", "invocation-execution.json");
            const initialStore = await readFile(storePath, "utf8");
            const lease = await store.establish({
                sessionId: 18,
                invocationId: "invocation-bootstrap-evidence",
                clientMessageId: "client-bootstrap-evidence",
            }, async () => undefined);
            if (evidenceKind === "provider witness") {
                await store.recordProviderStarted(lease);
                await rm(join(
                    root,
                    ".nbook",
                    "agent",
                    "invocation-execution.lock-target",
                    "fence-allocations",
                    `${lease.fence}.json`,
                ), {force: true});
            }
            await writeFile(storePath, initialStore, "utf8");
            const sentinelPath = join(root, ".nbook", "agent", "invocation-execution.lock-target", "initialized");
            await rm(sentinelPath, {force: true});

            await expect(store.ensureHealthy()).rejects.toMatchObject({
                code: "execution_evidence_lost",
            });
            await expect(readFile(storePath, "utf8")).resolves.toBe(initialStore);
            await expect(readFile(sentinelPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
        },
    );

    it("sentinel 丢失时不会覆盖 malformed 既有 store", async () => {
        await store.ensureHealthy();
        const storePath = join(root, ".nbook", "agent", "invocation-execution.json");
        const sentinelPath = join(root, ".nbook", "agent", "invocation-execution.lock-target", "initialized");
        const malformedStore = "{malformed-before-sentinel";
        await writeFile(storePath, malformedStore, "utf8");
        await rm(sentinelPath, {force: true});

        await expect(store.ensureHealthy()).rejects.toMatchObject({
            code: "execution_evidence_lost",
        });
        await expect(readFile(storePath, "utf8")).resolves.toBe(malformedStore);
        await expect(readFile(sentinelPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("terminal 后回滚主 store 也不能复用已经永久分配的 fence", async () => {
        await store.ensureHealthy();
        const storePath = join(root, ".nbook", "agent", "invocation-execution.json");
        const initialStore = await readFile(storePath, "utf8");
        const first = await store.establish({
            sessionId: 20,
            invocationId: "invocation-20-a",
            clientMessageId: "client-20-a",
        }, async () => undefined);
        await store.recordProviderStarted(first);
        await expect(store.withLiveExecutionFence(first, async () => "terminal")).resolves.toEqual({
            committed: true,
            value: "terminal",
        });

        await writeFile(storePath, initialStore, "utf8");

        await expect(store.establish({
            sessionId: 21,
            invocationId: "invocation-21-b",
            clientMessageId: "client-21-b",
        }, async () => undefined)).rejects.toMatchObject({
            code: "execution_evidence_lost",
        });
    });

    it("永久 allocation 已写入但主 store 发布失败时保持 fail closed，不跳过也不复用 fence", async () => {
        let failNextStorePublish = false;
        let failedStorePublish = false;
        const allocationFirstStore = new HarnessInvocationExecutionLeaseStore(root, {
            now: () => now,
            ownerId: () => "owner-allocation-first",
            leaseDurationMs: 1_000,
            fileIo: {
                async open(path: string, flags: "r" | "wx") {
                    const handle = await openFile(path, flags);
                    return {
                        async writeFile(content: string): Promise<void> {
                            if (failNextStorePublish
                                && !failedStorePublish
                                && path.includes("invocation-execution.json.")) {
                                failedStorePublish = true;
                                throw Object.assign(new Error("injected main store publish failure"), {code: "EIO"});
                            }
                            await handle.writeFile(content, "utf8");
                        },
                        async sync(): Promise<void> {
                            await handle.sync();
                        },
                        async close(): Promise<void> {
                            await handle.close();
                        },
                    };
                },
            },
        });
        await allocationFirstStore.ensureHealthy();
        failNextStorePublish = true;

        await expect(allocationFirstStore.establish({
            sessionId: 22,
            invocationId: "invocation-22-a",
            clientMessageId: "client-22-a",
        }, async () => undefined)).rejects.toThrow("injected main store publish failure");
        await expect(allocationFirstStore.establish({
            sessionId: 23,
            invocationId: "invocation-23-b",
            clientMessageId: "client-23-b",
        }, async () => undefined)).rejects.toMatchObject({
            code: "execution_evidence_lost",
        });
    });

    it("terminal prune 只按完整 identity 删除 Provider witness，不能只信 Session 的数字 fence", async () => {
        await store.ensureHealthy();
        const first = await store.establish({
            sessionId: 24,
            invocationId: "invocation-24",
            clientMessageId: "client-24",
        }, async () => undefined);
        const second = await store.establish({
            sessionId: 25,
            invocationId: "invocation-25",
            clientMessageId: "client-25",
        }, async () => undefined);
        await store.recordProviderStarted(first);
        await store.recordProviderStarted(second);

        await expect(store.resolve({
            sessionId: first.sessionId,
            clientMessageId: first.clientMessageId,
        }, async () => ({
            state: "terminal",
            invocationId: first.invocationId,
            executionFence: second.fence,
        }))).resolves.toEqual({state: "terminal"});

        await expect(store.recordProviderStarted(second)).resolves.toBeUndefined();
        await expect(store.resolve({
            sessionId: second.sessionId,
            clientMessageId: second.clientMessageId,
        }, async () => ({
            state: "nonterminal",
            invocationId: second.invocationId,
            executionLeaseEstablished: true,
            executionFence: second.fence,
        }))).resolves.toMatchObject({
            state: "active",
            invocationId: second.invocationId,
            lifecycle: "running",
        });
    });

    it.each(["missing allocation", "malformed allocation", "witness owner mismatch"] as const)(
        "terminal numeric-fence prune 遇到 %s 时保留 Provider witness",
        async (failureKind) => {
            await store.ensureHealthy();
            const lease = await store.establish({
                sessionId: 28,
                invocationId: "invocation-28",
                clientMessageId: "client-28",
            }, async () => undefined);
            await store.recordProviderStarted(lease);
            const storePath = join(root, ".nbook", "agent", "invocation-execution.json");
            const persisted = JSON.parse(await readFile(storePath, "utf8")) as {records: object[]};
            persisted.records = [];
            await writeFile(storePath, `${JSON.stringify(persisted)}\n`, "utf8");
            const allocationPath = join(
                root,
                ".nbook",
                "agent",
                "invocation-execution.lock-target",
                "fence-allocations",
                `${lease.fence}.json`,
            );
            const witnessPath = join(
                root,
                ".nbook",
                "agent",
                "invocation-execution.lock-target",
                "provider-start-witnesses",
                `${lease.fence}.json`,
            );
            if (failureKind === "missing allocation") {
                await rm(allocationPath, {force: true});
            } else if (failureKind === "malformed allocation") {
                await writeFile(allocationPath, "{malformed-allocation", "utf8");
            } else {
                const witness = JSON.parse(await readFile(witnessPath, "utf8")) as {ownerId: string};
                witness.ownerId = "different-owner";
                await writeFile(witnessPath, `${JSON.stringify(witness)}\n`, "utf8");
            }
            const witnessBefore = await readFile(witnessPath, "utf8");

            await expect(store.resolve({
                sessionId: lease.sessionId,
                clientMessageId: lease.clientMessageId,
            }, async () => ({
                state: "terminal",
                invocationId: lease.invocationId,
                executionFence: lease.fence,
            }))).resolves.toEqual({state: "terminal"});
            await expect(readFile(witnessPath, "utf8")).resolves.toBe(witnessBefore);
        },
    );

    it("terminal Session truth 不会被损坏的 matching Provider witness 反转", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 29,
            invocationId: "invocation-29",
            clientMessageId: "client-29",
        }, async () => undefined);
        await store.recordProviderStarted(lease);
        const witnessPath = join(
            root,
            ".nbook",
            "agent",
            "invocation-execution.lock-target",
            "provider-start-witnesses",
            `${lease.fence}.json`,
        );
        await writeFile(witnessPath, "{malformed-witness", "utf8");

        await expect(store.resolve({
            sessionId: lease.sessionId,
            clientMessageId: lease.clientMessageId,
        }, async () => ({
            state: "terminal",
            invocationId: lease.invocationId,
            executionFence: lease.fence,
        }))).resolves.toEqual({state: "terminal"});
        const persisted = JSON.parse(await readFile(
            join(root, ".nbook", "agent", "invocation-execution.json"),
            "utf8",
        )) as {records: object[]};
        expect(persisted.records).toEqual([]);
        await expect(readFile(witnessPath, "utf8")).resolves.toBe("{malformed-witness");
    });

    it("terminal commit 成功后 witness 清理失败不会反转 committed 结果", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 30,
            invocationId: "invocation-30",
            clientMessageId: "client-30",
        }, async () => undefined);
        await store.recordProviderStarted(lease);
        const witnessPath = join(
            root,
            ".nbook",
            "agent",
            "invocation-execution.lock-target",
            "provider-start-witnesses",
            `${lease.fence}.json`,
        );
        await writeFile(witnessPath, "{malformed-witness", "utf8");
        let terminalCommits = 0;

        await expect(store.withLiveExecutionFence(lease, async () => {
            terminalCommits += 1;
            return "terminal-written";
        })).resolves.toEqual({committed: true, value: "terminal-written"});
        expect(terminalCommits).toBe(1);
        await expect(readFile(witnessPath, "utf8")).resolves.toBe("{malformed-witness");
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
            executionFence: lease.fence,
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
            executionFence: lease.fence,
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

        const readDuringAdmissionGap = () => store.resolve({
            sessionId: 10,
            clientMessageId: "client-10",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-10",
            executionLeaseEstablished: false,
            executionFence: null,
        }));
        const expectedResolution = {
            state: "orphaned",
            invocationId: "invocation-10",
            providerStartRecorded: false,
        } as const;

        await expect(readDuringAdmissionGap()).resolves.toEqual(expectedResolution);
        await expect(readDuringAdmissionGap()).resolves.toEqual(expectedResolution);

        await expect(store.establish({
            sessionId: 10,
            invocationId: "invocation-10",
            clientMessageId: "client-10",
        }, async () => undefined)).rejects.toThrow("execution lease identity 已存在");
    });

    it.each(["missing", "malformed"] as const)(
        "store %s 且 Session 明确没有 execution marker 时仍给出可重复的 false",
        async (failureKind) => {
            await store.ensureHealthy();
            const path = join(root, ".nbook", "agent", "invocation-execution.json");
            if (failureKind === "missing") {
                await rm(path, {force: true});
            } else {
                await writeFile(path, "{broken-store", "utf8");
            }
            const readWithoutMarker = () => store.resolve({
                sessionId: 26,
                clientMessageId: "client-26",
            }, async () => ({
                state: "nonterminal",
                invocationId: "invocation-26",
                executionLeaseEstablished: false,
                executionFence: null,
            }));

            await expect(readWithoutMarker()).resolves.toEqual({
                state: "orphaned",
                invocationId: "invocation-26",
                providerStartRecorded: false,
            });
            await expect(readWithoutMarker()).resolves.toEqual({
                state: "orphaned",
                invocationId: "invocation-26",
                providerStartRecorded: false,
            });
        },
    );

    it.each(["missing", "malformed"] as const)(
        "store %s 后 Session 已出现 execution marker 时只能返回 unknown",
        async (failureKind) => {
            await store.ensureHealthy();
            const path = join(root, ".nbook", "agent", "invocation-execution.json");
            if (failureKind === "missing") {
                await rm(path, {force: true});
            } else {
                await writeFile(path, "{broken-store", "utf8");
            }

            await expect(store.resolve({
                sessionId: 27,
                clientMessageId: "client-27",
            }, async () => ({
                state: "nonterminal",
                invocationId: "invocation-27",
                executionLeaseEstablished: true,
                executionFence: 1,
            }))).resolves.toEqual({
                state: "orphaned",
                invocationId: "invocation-27",
                providerStartRecorded: null,
            });
        },
    );

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
        const lease = await store.establish({
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
        }, async () => ({
            state: "terminal",
            invocationId: "invocation-11",
            executionFence: lease.fence,
        }))).resolves.toEqual({state: "terminal"});
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
            executionFence: 1,
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
            executionFence: lease.fence,
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
        }, async () => ({
            state: "terminal",
            invocationId: "invocation-8",
            executionFence: lease.fence,
        }))).resolves.toEqual({state: "terminal"});
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
            executionFence: lease.fence,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-9",
            providerStartRecorded: null,
        });
    });

    it("rolling the whole sidecar back to a valid pre-start snapshot never downgrades Provider evidence to false", async () => {
        await store.ensureHealthy();
        const lease = await store.establish({
            sessionId: 16,
            invocationId: "invocation-16",
            clientMessageId: "client-16",
        }, async () => undefined);
        const path = join(root, ".nbook", "agent", "invocation-execution.json");
        const beforeProviderStart = await readFile(path, "utf8");
        await store.recordProviderStarted(lease);
        await writeFile(path, beforeProviderStart, "utf8");

        now += 1_001;
        await expect(store.resolve({
            sessionId: 16,
            clientMessageId: "client-16",
        }, async () => ({
            state: "nonterminal",
            invocationId: "invocation-16",
            executionLeaseEstablished: true,
            executionFence: lease.fence,
        }))).resolves.toEqual({
            state: "orphaned",
            invocationId: "invocation-16",
            providerStartRecorded: null,
        });
    });

    it.each(["write", "sync"] as const)(
        "cleans the durable temp file when %s fails after open",
        async (failureStage) => {
            const caseRoot = join(root, `temp-${failureStage}`);
            const failingStore = new HarnessInvocationExecutionLeaseStore(caseRoot, {
                fileIo: {
                    async open(path: string, flags: "r" | "wx") {
                        const handle = await openFile(path, flags);
                        return {
                            async writeFile(content: string): Promise<void> {
                                if (failureStage === "write") {
                                    await handle.writeFile("partial", "utf8");
                                    throw new Error("injected temp write failure");
                                }
                                await handle.writeFile(content, "utf8");
                            },
                            async sync(): Promise<void> {
                                if (failureStage === "sync") {
                                    throw new Error("injected temp sync failure");
                                }
                                await handle.sync();
                            },
                            async close(): Promise<void> {
                                await handle.close();
                            },
                        };
                    },
                },
            } as unknown as ConstructorParameters<typeof HarnessInvocationExecutionLeaseStore>[1]);

            await expect(failingStore.ensureHealthy()).rejects.toThrow(`injected temp ${failureStage} failure`);
            const agentRoot = join(caseRoot, ".nbook", "agent");
            const temporaryFiles = (await readdir(agentRoot))
                .filter((name) => name.endsWith(".tmp"));
            expect(temporaryFiles).toEqual([]);
        },
    );

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
            ? {
                state: "terminal",
                invocationId: "invocation-13",
                executionFence: lease.fence,
            }
            : {
                state: "nonterminal",
                invocationId: "invocation-13",
                executionLeaseEstablished: true,
                executionFence: lease.fence,
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
                executionFence: lease.fence,
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
            ? {
                state: "terminal",
                invocationId: "invocation-15",
                executionFence: lease.fence,
            }
            : {
                state: "nonterminal",
                invocationId: "invocation-15",
                executionLeaseEstablished: true,
                executionFence: lease.fence,
            })).resolves.toEqual({state: "terminal"});
        const persisted = JSON.parse(await readFile(
            join(root, ".nbook", "agent", "invocation-execution.json"),
            "utf8",
        )) as {records: object[]};
        expect(persisted.records).toEqual([]);
    });
});
