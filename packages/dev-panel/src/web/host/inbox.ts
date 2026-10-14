import type {InboxConflict, InboxItem, InboxQuestion} from "./types.js";

/**
 * 首页收件箱按产物合并提问（t15 阶段 4 第 1 批，开发者 10-13）：一个产物出几道待答题时合成一行，注意力按“去哪个产物答”分，
 * 不按题分。撞号照旧一条一行。顺序按服务端给的顺序，取每个产物第一次出现的位置。
 */
export type InboxArtifact = {
    kind: "artifact";
    key: string;
    workId: string;
    taskId: string;
    artifactId: string;
    title: string | null;
    questions: InboxQuestion[];
    /** 提问的会话，去重；同一个会话只要有一道题的租约还在就算在。 */
    askers: Array<{key: string; active: boolean | null}>;
};
export type InboxRow = InboxArtifact | InboxConflict;

export function groupInbox(items: readonly InboxItem[]): InboxRow[] {
    const rows: InboxRow[] = [];
    const byKey = new Map<string, InboxArtifact>();
    for (const item of items) {
        if (item.kind !== "question") {
            rows.push(item);
            continue;
        }
        const key = `${item.workId}/${item.taskId}/${item.artifactId}`;
        let row = byKey.get(key);
        if (!row) {
            row = {kind: "artifact", key, workId: item.workId, taskId: item.taskId, artifactId: item.artifactId, title: item.artifactTitle, questions: [], askers: []};
            byKey.set(key, row);
            rows.push(row);
        }
        row.questions.push(item);
        if (item.askedBy === null) continue;
        const asker = row.askers.find((entry) => entry.key === item.askedBy);
        if (!asker) row.askers.push({key: item.askedBy, active: item.askerActive});
        else if (item.askerActive === true || (asker.active === null && item.askerActive === false)) asker.active = item.askerActive;
    }
    return rows;
}
