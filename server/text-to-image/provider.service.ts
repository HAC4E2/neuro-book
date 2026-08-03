import type {Prisma} from "nbook/server/generated/prisma/client";
import type {TextToImageProviderKind} from "nbook/shared/dto/text-to-image.dto";
import {prisma} from "nbook/server/utils/prisma";
import {
    openTextToImageCredential,
    sealTextToImageCredential,
} from "nbook/server/text-to-image/provider-credential";

/** App SQLite 中持久化的 Provider 记录，凭据字段只保存 AES-GCM 密文。 */
export type TextToImageProviderRecord = {
    id: number;
    ownerUserId: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model: string | null;
    credentialCiphertext: string;
    credentialIv: string;
    credentialTag: string;
    credentialRevision: number;
    settings: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
};

/** 返回给前端的 Provider 快照，永不包含密文材料。 */
export type TextToImageProviderDto = {
    id: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model: string | null;
    hasCredential: boolean;
    credentialRevision: number;
    settings: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
};

/** Provider 存储抽象；业务测试使用内存实现，生产使用 Prisma。 */
export interface TextToImageProviderStore {
    list(ownerUserId: number): Promise<TextToImageProviderRecord[]>;
    find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null>;
    create(input: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord>;
    update(
        ownerUserId: number,
        id: number,
        update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>,
    ): Promise<TextToImageProviderRecord | null>;
    delete(ownerUserId: number, id: number): Promise<boolean>;
}

/** 缺少完整凭据时的稳定业务错误。 */
export class TextToImageProviderNotConfiguredError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_NOT_CONFIGURED";

    constructor() {
        super("文生图 Provider 尚未配置完整 API token，请先保存凭据。");
        this.name = "TextToImageProviderNotConfiguredError";
    }
}

export type SaveTextToImageProviderInput = {
    /** 更新已有 Provider 时必填；缺省时按 name 匹配。 */
    id?: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model?: string | null;
    settings: Record<string, unknown>;
    /** 传入非空值表示替换凭据；undefined 或空串表示保留已有密文。 */
    credential?: string;
};

/**
 * 文生图 Provider 服务：凭据密封/打开、修订版本号和脱敏 DTO。
 * 首版只做单 Provider CRUD，不迁 reconciliation / lane saga。
 */
export class TextToImageProviderService {
    constructor(
        private readonly store: TextToImageProviderStore = new PrismaTextToImageProviderStore(),
        private readonly keyPath?: string,
    ) {}

    /** 列出当前 owner 的 Provider，DTO 不暴露凭据。 */
    async list(ownerUserId: number): Promise<TextToImageProviderDto[]> {
        const records = await this.store.list(ownerUserId);
        return records.map(toProviderDto);
    }

    /** 新建或更新 Provider；凭据仅在明文变化时递增 revision。 */
    async save(ownerUserId: number, input: SaveTextToImageProviderInput): Promise<TextToImageProviderDto> {
        const existing = input.id !== undefined
            ? await this.store.find(ownerUserId, input.id)
            : (await this.store.list(ownerUserId)).find((record) => record.name === input.name) ?? null;
        const credentialChanged = await resolveCredentialChange(existing, input.credential, this.keyPath);
        const sealed = credentialChanged.sealed;
        const revision = existing
            ? existing.credentialRevision + (credentialChanged.changed ? 1 : 0)
            : 1;

        const record = existing
            ? await this.store.update(ownerUserId, existing.id, {
                kind: input.kind,
                name: input.name,
                baseUrl: input.baseUrl,
                model: input.model ?? null,
                settings: input.settings,
                credentialCiphertext: sealed.ciphertext,
                credentialIv: sealed.iv,
                credentialTag: sealed.tag,
                credentialRevision: revision,
            })
            : await this.store.create({
                ownerUserId,
                kind: input.kind,
                name: input.name,
                baseUrl: input.baseUrl,
                model: input.model ?? null,
                credentialCiphertext: sealed.ciphertext,
                credentialIv: sealed.iv,
                credentialTag: sealed.tag,
                credentialRevision: revision,
                settings: input.settings,
            });
        if (!record) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return toProviderDto(record);
    }

    /** 删除 Provider。 */
    async remove(ownerUserId: number, id: number): Promise<boolean> {
        return this.store.delete(ownerUserId, id);
    }

    /** 打开凭据；密文缺失或无法解密时抛出稳定错误。 */
    async resolveCredential(ownerUserId: number, id: number): Promise<string> {
        const record = await this.store.find(ownerUserId, id);
        if (!record || !hasCompleteCredential(record)) {
            throw new TextToImageProviderNotConfiguredError();
        }
        try {
            return await openTextToImageCredential({
                ciphertext: record.credentialCiphertext,
                iv: record.credentialIv,
                tag: record.credentialTag,
            }, this.keyPath);
        } catch {
            throw new TextToImageProviderNotConfiguredError();
        }
    }

    /** 返回运行直调所需的设置与明文凭据。 */
    async resolveRuntimeProvider(ownerUserId: number, id: number): Promise<{settings: Record<string, unknown>; credential: string}> {
        const record = await this.store.find(ownerUserId, id);
        if (!record) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return {
            settings: record.settings,
            credential: await this.resolveCredential(ownerUserId, id),
        };
    }
}

async function resolveCredentialChange(
    existing: TextToImageProviderRecord | null,
    credential: string | undefined,
    keyPath: string | undefined,
): Promise<{sealed: {ciphertext: string; iv: string; tag: string}; changed: boolean}> {
    if (credential && credential.trim() !== "") {
        if (existing && hasCompleteCredential(existing)) {
            const previous = await openTextToImageCredential({
                ciphertext: existing.credentialCiphertext,
                iv: existing.credentialIv,
                tag: existing.credentialTag,
            }, keyPath).catch(() => "");
            if (previous === credential) {
                return {
                    sealed: {
                        ciphertext: existing.credentialCiphertext,
                        iv: existing.credentialIv,
                        tag: existing.credentialTag,
                    },
                    changed: false,
                };
            }
        }
        return {
            sealed: await sealTextToImageCredential(credential, keyPath),
            changed: true,
        };
    }
    if (!existing || !hasCompleteCredential(existing)) {
        throw new TextToImageProviderNotConfiguredError();
    }
    return {
        sealed: {
            ciphertext: existing.credentialCiphertext,
            iv: existing.credentialIv,
            tag: existing.credentialTag,
        },
        changed: false,
    };
}

function hasCompleteCredential(record: TextToImageProviderRecord): boolean {
    return record.credentialCiphertext !== ""
        && record.credentialIv !== ""
        && record.credentialTag !== "";
}

function toProviderDto(record: TextToImageProviderRecord): TextToImageProviderDto {
    return {
        id: record.id,
        kind: record.kind,
        name: record.name,
        baseUrl: record.baseUrl,
        model: record.model,
        hasCredential: hasCompleteCredential(record),
        credentialRevision: record.credentialRevision,
        settings: record.settings,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

class PrismaTextToImageProviderStore implements TextToImageProviderStore {
    async list(ownerUserId: number): Promise<TextToImageProviderRecord[]> {
        return await prisma.textToImageProvider.findMany({
            where: {ownerUserId},
        }) as unknown as TextToImageProviderRecord[];
    }

    async find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null> {
        return await prisma.textToImageProvider.findFirst({
            where: {ownerUserId, id},
        }) as unknown as TextToImageProviderRecord | null;
    }

    async create(input: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord> {
        return await prisma.textToImageProvider.create({
            data: {
                ...input,
                settings: input.settings as Prisma.InputJsonValue,
            },
        }) as unknown as TextToImageProviderRecord;
    }

    async update(
        ownerUserId: number,
        id: number,
        update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>,
    ): Promise<TextToImageProviderRecord | null> {
        const existing = await this.find(ownerUserId, id);
        if (!existing) return null;
        return await prisma.textToImageProvider.update({
            where: {id},
            data: {
                ...update,
                settings: update.settings as Prisma.InputJsonValue | undefined,
            },
        }) as unknown as TextToImageProviderRecord;
    }

    async delete(ownerUserId: number, id: number): Promise<boolean> {
        const existing = await this.find(ownerUserId, id);
        if (!existing) return false;
        await prisma.textToImageProvider.delete({where: {id}});
        return true;
    }
}
