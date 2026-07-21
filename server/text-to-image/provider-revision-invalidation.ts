import {createHash} from "node:crypto";

export type ProviderRevisionInvalidationIdentity = {
    ownerUserId: number;
    providerId: number;
    oldRevision: number;
    newRevision: number;
    projectId: string;
};

/** 为同一 Provider revision 与精确 Project 目标生成跨事务稳定 saga ID。 */
export function createProviderRevisionInvalidationId(identity: ProviderRevisionInvalidationIdentity): string {
    const canonicalIdentity = [
        identity.ownerUserId,
        identity.providerId,
        identity.oldRevision,
        identity.newRevision,
        identity.projectId,
    ] as const;
    return `provider-revision:${createHash("sha256").update(JSON.stringify(canonicalIdentity), "utf8").digest("hex")}`;
}
