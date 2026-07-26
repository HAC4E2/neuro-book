import {randomUUID} from "node:crypto";
import {
    createSharedSystemAssetsSnapshot,
    removeFixtureTree,
    sweepStaleFixtureRoots,
    TEST_RUN_ID_ENV,
    TEST_SYSTEM_ASSETS_SNAPSHOT_ENV,
} from "nbook/server/workspace-files/test-workspace-fixture";

/** 本次 run 建立的共享 snapshot；teardown 时删除。 */
let snapshotRoot: string | null = null;

/**
 * Vitest run 级准备。
 *
 * 先保守回收上一次运行留下的 fixture 残留，再建立一份 run 级共享只读
 * system assets snapshot，通过环境变量传给各测试 fork。这样单次 run 只投影
 * 一份 system 模板，而不是每个用例复制一份完整 `.nbook`。
 */
export async function setup(): Promise<void> {
    process.env[TEST_RUN_ID_ENV] = randomUUID();
    const sweep = await sweepStaleFixtureRoots();
    if (sweep.removed.length > 0 || sweep.failures.length > 0) {
        console.info(`[fixture] 回收残留 root ${sweep.removed.length} 个，保留 ${sweep.retained.length} 个，失败 ${sweep.failures.length} 个`);
    }
    snapshotRoot = await createSharedSystemAssetsSnapshot();
    process.env[TEST_SYSTEM_ASSETS_SNAPSHOT_ENV] = snapshotRoot;
}

/**
 * run 结束时删除共享 snapshot。
 * 进程被强杀时这里不会执行，由下一次 run 的 sweep 按 owner marker 兜底回收。
 */
export async function teardown(): Promise<void> {
    if (snapshotRoot) {
        await removeFixtureTree(snapshotRoot).catch(() => undefined);
        snapshotRoot = null;
    }
}
