import {describe, expect, it} from "vitest";
import {
    IllustrationPlaceholderStatusService,
    type IllustrationPlaceholderJobSnapshot,
} from "nbook/server/text-to-image/illustration-placeholder.service";

const SOURCE_IDENTITY = `sha256:${"a".repeat(64)}`;
const INPUT = {projectPath: "workspace/demo", ownerUserId: 7, placeholderId: "placeholder-1"};

/** 构造最小 Job 快照；status/sourceInsertStatus 按用例覆盖。 */
function job(overrides: Partial<IllustrationPlaceholderJobSnapshot>): IllustrationPlaceholderJobSnapshot {
    return {
        id: "job-1",
        status: "queued",
        sourceInsertStatus: "pending",
        stableErrorCode: null,
        errorMessage: null,
        updatedAt: "2026-07-27T00:00:00.000Z",
        ...overrides,
    };
}

function service(latest: IllustrationPlaceholderJobSnapshot | null): IllustrationPlaceholderStatusService {
    return new IllustrationPlaceholderStatusService({
        readLatestJob: async () => latest,
        readSourceIdentity: async () => SOURCE_IDENTITY,
    });
}

describe("IllustrationPlaceholderStatusService 终态放行", () => {
    it.each([
        ["failed", job({status: "failed"})],
        ["canceled", job({status: "canceled"})],
        ["interrupted", job({status: "interrupted"})],
        ["succeeded+missing（重roll还原后）", job({status: "succeeded", sourceInsertStatus: "missing"})],
    ])("最新 Job 为 %s 时回退 target 校验并重新 ready", async (_label, latest) => {
        const status = await service(latest).read(INPUT);

        expect(status.status).toBe("ready");
        expect(status.sourceIdentityHash).toBe(SOURCE_IDENTITY);
        expect(status.job).toBeNull();
    });

    it.each([
        ["queued", job({status: "queued"}), "queued"],
        ["running", job({status: "running"}), "running"],
        ["completing", job({status: "completing"}), "running"],
        ["succeeded+inserted", job({status: "succeeded", sourceInsertStatus: "inserted"}), "running"],
        ["outcome_unknown（可能已扣费，保持冻结投影）", job({status: "outcome_unknown"}), "outcome_unknown"],
        ["configuration_stale（凭据已更换，保持冻结投影）", job({status: "configuration_stale"}), "stale"],
    ])("活动中、已插入或计费不确定的 %s Job 仍然短路为 Job 投影", async (_label, latest, expected) => {
        const status = await service(latest).read(INPUT);

        expect(status.status).toBe(expected);
        expect(status.job?.jobId).toBe("job-1");
    });
});
