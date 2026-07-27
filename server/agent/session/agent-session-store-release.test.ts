import {createHash, randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    acquireAgentSessionStoreExclusiveLease,
    acquireReadyAgentSessionStore,
    agentSessionStoreSentinelPath,
    type AgentSessionStoreSentinel,
} from "nbook/server/agent/session/agent-session-store";

const lockAdapter = vi.hoisted(() => ({
    held: false,
    releaseAttempts: 0,
    remainingReleaseFailures: 0,
    releaseBarrier: null as Promise<void> | null,
    lock: vi.fn<(path: string) => Promise<() => Promise<void>>>(),
}));

vi.mock("proper-lockfile", () => ({lock: lockAdapter.lock}));

describe("Agent Session Store release failure", () => {
    const roots: string[] = [];
    const releaseFailure = new Error("injected physical release failure");

    beforeEach(() => {
        lockAdapter.held = false;
        lockAdapter.releaseAttempts = 0;
        lockAdapter.remainingReleaseFailures = 0;
        lockAdapter.releaseBarrier = null;
        lockAdapter.lock.mockReset();
        lockAdapter.lock.mockImplementation(async () => {
            if (lockAdapter.held) {
                throw Object.assign(new Error("Lock file is already being held"), {code: "ELOCKED"});
            }
            lockAdapter.held = true;
            return async () => {
                lockAdapter.releaseAttempts += 1;
                if (lockAdapter.remainingReleaseFailures > 0) {
                    lockAdapter.remainingReleaseFailures -= 1;
                    throw releaseFailure;
                }
                if (lockAdapter.releaseBarrier) {
                    await lockAdapter.releaseBarrier;
                }
                lockAdapter.held = false;
            };
        });
    });

    afterEach(async () => {
        lockAdapter.held = false;
        lockAdapter.releaseBarrier = null;
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("并发release共享同一失败，原owner重试成功前exclusive始终fail closed", async () => {
        const root = await readyRoot();
        lockAdapter.remainingReleaseFailures = 1;
        const runtime = await acquireReadyAgentSessionStore(root);

        const [first, second] = await Promise.allSettled([runtime.release(), runtime.release()]);

        expect(first).toEqual({status: "rejected", reason: releaseFailure});
        expect(second).toEqual({status: "rejected", reason: releaseFailure});
        expect(lockAdapter.releaseAttempts).toBe(1);
        await expect(acquireAgentSessionStoreExclusiveLease(root)).rejects.toMatchObject({code: "ELOCKED"});

        await runtime.release();
        expect(lockAdapter.releaseAttempts).toBe(2);
        const releaseExclusive = await acquireAgentSessionStoreExclusiveLease(root);
        await releaseExclusive();
    });

    it("并发release都等待同一次物理解锁完成", async () => {
        const root = await readyRoot();
        let finishPhysicalRelease: () => void = () => undefined;
        lockAdapter.releaseBarrier = new Promise<void>((resolveBarrier) => {
            finishPhysicalRelease = resolveBarrier;
        });
        const runtime = await acquireReadyAgentSessionStore(root);
        let firstSettled = false;
        let secondSettled = false;
        const first = runtime.release().then(() => {
            firstSettled = true;
        });
        const second = runtime.release().then(() => {
            secondSettled = true;
        });

        try {
            await vi.waitFor(() => expect(lockAdapter.releaseAttempts).toBe(1));
            expect(firstSettled).toBe(false);
            expect(secondSettled).toBe(false);
        } finally {
            finishPhysicalRelease();
            await Promise.allSettled([first, second]);
        }

        expect(lockAdapter.releaseAttempts).toBe(1);
        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
    });

    /** 创建当前schema complete sentinel的隔离Workspace Root。 */
    async function readyRoot(): Promise<string> {
        const root = resolve(".agent", "agent-session-store-release-test", randomUUID());
        roots.push(root);
        const path = agentSessionStoreSentinelPath(root);
        const sentinel: AgentSessionStoreSentinel = {
            sentinelVersion: 1,
            state: "complete",
            sourceSchemaVersion: 1,
            targetSchemaVersion: 2,
            runId: "release-test",
            manifestPath: ".nbook/agent/migrations/session-v2/release-test/manifest.json",
            manifestHash: "c".repeat(64),
            checkpointCursor: 1,
        };
        const manifestPath = resolve(root, ...sentinel.manifestPath.split("/"));
        const manifestText = `${JSON.stringify({
            runId: sentinel.runId,
            appliedSeq: sentinel.checkpointCursor,
            status: "report_written",
        })}\n`;
        await mkdir(dirname(manifestPath), {recursive: true});
        await writeFile(manifestPath, manifestText, "utf8");
        sentinel.manifestHash = createHash("sha256").update(manifestText).digest("hex");
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, JSON.stringify(sentinel), "utf8");
        return root;
    }
});
