import {randomBytes} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {readArtifact, sha256Hex, versionPath, type ArtifactRef} from "./artifacts.js";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {isIsoTime, isRecord} from "./json.js";
import {parseLeaseSession, type LeaseRecord, type LeaseSession} from "./leases.js";
import {AGENT_LOCAL_ROOT} from "./registry.js";
import {WORKS_ROOT} from "./repo.js";

/**
 * 运行时的 provenance：某个入库文件（发布记录、代录的答复、确认）是哪个会话写的。入库文件里没有任何指向会话的字段，
 * 提问者（askedBy）只记在这里，不入库；路径与入库文件相对 `.agents/works/` 的路径相同。
 * 记下入库文件的 sha256：入库文件被删掉又由别人重建时，旧的记录不会冒认成新文件的作者。
 */
export const PROVENANCE_SCHEMA = "nbdev.provenance/v1";
export const PROVENANCE_ROOT = `${AGENT_LOCAL_ROOT}/run/provenance`;

export type ProvenanceAction = "publish" | "close" | "ask" | "withdraw" | "supersede" | "record" | "ack";
export type ProvenanceRecord = {
    schema: typeof PROVENANCE_SCHEMA;
    path: string;
    sha256: string;
    action: ProvenanceAction;
    leaseId: string;
    session: LeaseSession;
    recordedAt: string;
};

function provenanceFile(mainRoot: string, projectPath: string): string {
    if (!projectPath.startsWith(`${WORKS_ROOT}/`) || projectPath.split("/").includes("..")) {
        throw new NbdevError("unsafe_path", `provenance 只记 ${WORKS_ROOT}/ 下的入库文件：${projectPath}`, {details: {path: projectPath}});
    }
    return resolve(mainRoot, PROVENANCE_ROOT, projectPath.slice(WORKS_ROOT.length + 1));
}

export async function writeProvenance(mainRoot: string, input: {path: string; content: string; action: ProvenanceAction; lease: LeaseRecord; now: Date}): Promise<ProvenanceRecord> {
    const record: ProvenanceRecord = {
        schema: PROVENANCE_SCHEMA,
        path: input.path,
        sha256: sha256Hex(input.content),
        action: input.action,
        leaseId: input.lease.leaseId,
        session: input.lease.session,
        recordedAt: input.now.toISOString(),
    };
    const target = provenanceFile(mainRoot, input.path);
    const temporary = `${target}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
        await mkdir(dirname(target), {recursive: true});
        await writeFile(temporary, `${JSON.stringify(record, null, 4)}\n`, {encoding: "utf8", flag: "wx"});
        await rename(temporary, target);
    } catch (error) {
        await rm(temporary, {force: true});
        throw new NbdevError("write_failed", `写 provenance 失败：${input.path}`, {cause: error, details: {path: input.path}});
    }
    return record;
}

/** 读一份 provenance；不存在为 null，读不出给 `unreadable_provenance` 警告后也为 null（它只是线索，不影响记录）。 */
export async function readProvenance(mainRoot: string, projectPath: string, warnings: Warning[] = []): Promise<ProvenanceRecord | null> {
    let text: string;
    try {
        text = await readFile(provenanceFile(mainRoot, projectPath), "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        if (systemErrorCode(error) === undefined) throw error;
        warnings.push({code: "unreadable_provenance", message: `provenance 读不了：${projectPath}（${systemErrorCode(error)}）`, details: {path: projectPath}});
        return null;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        warnings.push({code: "unreadable_provenance", message: `provenance 不是合法 JSON：${projectPath}（${error instanceof Error ? error.message : String(error)}）`, details: {path: projectPath}});
        return null;
    }
    const session = isRecord(value) ? parseLeaseSession(value.session) : "不是对象";
    if (!isRecord(value) || typeof session === "string" || value.schema !== PROVENANCE_SCHEMA || value.path !== projectPath || typeof value.sha256 !== "string"
        || typeof value.action !== "string" || typeof value.leaseId !== "string" || !isIsoTime(value.recordedAt)) {
        warnings.push({code: "unreadable_provenance", message: `provenance 格式不对：${projectPath}`, details: {path: projectPath}});
        return null;
    }
    return {schema: PROVENANCE_SCHEMA, path: projectPath, sha256: value.sha256, action: value.action as ProvenanceAction, leaseId: value.leaseId, session, recordedAt: value.recordedAt};
}

/** 读 provenance 并核对它记的 sha256 与磁盘上的入库文件一致；不一致（文件被改过或重建过）时为 null。 */
export async function verifiedProvenance(mainRoot: string, projectPath: string, warnings: Warning[] = []): Promise<ProvenanceRecord | null> {
    const record = await readProvenance(mainRoot, projectPath, warnings);
    if (!record) return null;
    let content: Buffer;
    try {
        content = await readFile(resolve(mainRoot, projectPath));
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
    return sha256Hex(content) === record.sha256 ? record : null;
}

/**
 * 提问者：题第一次出现的那一版（`since`）是谁发布的。找不到（别的机器、删过 `.local`、发布记录被重建）时为 null，
 * t11 这时降级为“列出其它持有这个 Task 租约的会话”。
 */
export async function askerOf(mainRoot: string, ref: ArtifactRef, questionId: string, warnings: Warning[] = []): Promise<ProvenanceRecord | null> {
    const snapshot = await readArtifact(mainRoot, ref);
    const question = snapshot.latest?.questions.find((entry) => entry.id === questionId);
    if (!question) return null;
    return verifiedProvenance(mainRoot, versionPath(ref, question.since), warnings);
}
