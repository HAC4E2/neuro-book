import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    buildTransactionEnvelope,
    recoverUnfinishedTransactions,
    removeTransactionJournal,
    transactionJournalRoot,
    writeTransactionJournal,
} from "nbook/server/text-to-image/transaction-journal";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("统一事务恢复调度器", () => {
    it("按 kind 分派四类并存日志，且不删除未知/损坏/未知版本日志", async () => {
        const root = await createRoot();
        const called: string[] = [];
        const handlers = Object.fromEntries(
            ["group-migration-v1", "visual-move-v1", "identity-v1", "trigger-words-v1"].map((kind) => [
                kind,
                async (_projectRoot: string, envelope: {transactionId: string}) => {
                    called.push(`${kind}:${envelope.transactionId}`);
                },
            ]),
        ) as Parameters<typeof recoverUnfinishedTransactions>[1];

        for (const [index, kind] of ["group-migration-v1", "visual-move-v1", "identity-v1", "trigger-words-v1"].entries()) {
            await writeTransactionJournal(root, buildTransactionEnvelope({
                kind: kind as never,
                transactionId: `known-${index}`,
                state: "backed-up",
                createdAt: new Date(0).toISOString(),
                payload: {},
            }));
        }
        await writeFile(path.join(transactionJournalRoot(root), "corrupt.json"), "{not-json", "utf8");
        await writeFile(path.join(transactionJournalRoot(root), "unknown.json"), JSON.stringify({
            kind: "unknown-kind", version: 1, transactionId: "unknown", state: "backed-up", createdAt: new Date(0).toISOString(), payload: {},
        }), "utf8");
        await writeFile(path.join(transactionJournalRoot(root), "old-version.json"), JSON.stringify({
            kind: "visual-move-v1", version: 99, transactionId: "old-version", state: "backed-up", createdAt: new Date(0).toISOString(), payload: {},
        }), "utf8");

        const report = await recoverUnfinishedTransactions(root, handlers, {activeWindowMs: 0});

        expect(called).toEqual([
            "group-migration-v1:known-0",
            "visual-move-v1:known-1",
            "identity-v1:known-2",
            "trigger-words-v1:known-3",
        ]);
        expect(report.recovered).toEqual(["known-0", "known-1", "known-2", "known-3"]);
        expect(report.kept.map((issue) => issue.entry)).toEqual(["corrupt.json", "old-version.json", "unknown.json"]);
        expect(report.kept.map((issue) => issue.reason)).toEqual(["corrupt", "unknown-version", "unknown-kind"]);
        expect(await readdir(transactionJournalRoot(root))).toEqual(expect.arrayContaining([
            "corrupt.json",
            "old-version.json",
            "unknown.json",
        ]));
    });

    it("仍在活跃窗口内的中断日志只报告跳过，不回滚", async () => {
        const root = await createRoot();
        const called: string[] = [];
        const transactionId = "active";
        await writeTransactionJournal(root, buildTransactionEnvelope({
            kind: "identity-v1",
            transactionId,
            state: "files-committed",
            createdAt: new Date().toISOString(),
            payload: {},
        }));

        const report = await recoverUnfinishedTransactions(root, {
            "identity-v1": async () => {
                called.push(transactionId);
            },
        }, {activeWindowMs: 60_000, now: () => Date.now()});

        expect(called).toEqual([]);
        expect(report.skippedActive).toEqual([transactionId]);
        expect(report.recovered).toEqual([]);
    });

    it("committed 日志完成清理收尾并从 .txn 中移除", async () => {
        const root = await createRoot();
        const transactionId = "committed";
        const journalPath = path.join(transactionJournalRoot(root), `${transactionId}.json`);
        await writeTransactionJournal(root, buildTransactionEnvelope({
            kind: "group-migration-v1",
            transactionId,
            state: "committed",
            payload: {},
        }));

        const report = await recoverUnfinishedTransactions(root, {
            "group-migration-v1": async (_projectRoot, envelope) => {
                await removeTransactionJournal(_projectRoot, envelope.transactionId);
            },
        }, {activeWindowMs: 0});

        expect(report.finalized).toEqual([transactionId]);
        await expect(readFile(journalPath, "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("缺少 kind 或 payload 的日志报告 invalid-envelope 并保留", async () => {
        const root = await createRoot();
        await mkdir(transactionJournalRoot(root), {recursive: true});
        await writeFile(path.join(transactionJournalRoot(root), "missing-payload.json"), JSON.stringify({
            kind: "identity-v1",
            version: 1,
            transactionId: "missing-payload",
            state: "backed-up",
            createdAt: new Date(0).toISOString(),
        }), "utf8");

        const report = await recoverUnfinishedTransactions(root, {}, {activeWindowMs: 0});

        expect(report.kept).toEqual([{entry: "missing-payload.json", reason: "invalid-envelope"}]);
    });
});

async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), "nbook-txn-journal-"));
    roots.push(root);
    return root;
}
