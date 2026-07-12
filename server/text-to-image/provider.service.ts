import {createError} from "h3";
import type {TextToImageProviderDto, TextToImageProviderKind} from "nbook/shared/dto/text-to-image.dto";
import type {TextToImageProvider} from "nbook/server/generated/prisma/client";
import {prisma} from "nbook/server/utils/prisma";
import {
    openTextToImageCredential,
    sealTextToImageCredential,
} from "nbook/server/text-to-image/provider-credential";
import {assertTextToImageProviderUrl} from "nbook/server/text-to-image/provider-url-policy";
import {
    TextToImageProviderCreateSchema,
    TextToImageProviderPatchSchema,
    TextToImageProviderSettingsSchema,
    TEXT_TO_IMAGE_NOVELAI_BASE_URL,
    type TextToImageProviderCreateInput,
    type TextToImageProviderPatchInput,
} from "nbook/server/text-to-image/schemas";

export type TextToImageProviderSettings = TextToImageProviderDto["settings"];

export type TextToImageProviderRecord = {
    id: number;
    ownerUserId: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model: string;
    credentialCiphertext: string;
    credentialIv: string;
    credentialTag: string;
    settings: TextToImageProviderSettings;
    createdAt: Date;
    updatedAt: Date;
};

/**
 * 隔离 Provider 领域服务与 App Prisma 客户端，测试只需提供具备 owner scope 的最小存储实现。
 */
export interface TextToImageProviderStore {
    create(record: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord>;
    findMany(ownerUserId: number): Promise<TextToImageProviderRecord[]>;
    find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null>;
    update(ownerUserId: number, id: number, update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>): Promise<TextToImageProviderRecord | null>;
    delete(ownerUserId: number, id: number): Promise<boolean>;
}

/**
 * Provider 安全边界：所有读写均绑定 owner，DTO 永不包含密钥材料。
 */
export class TextToImageProviderService {
    constructor(
        private readonly store: TextToImageProviderStore = new PrismaTextToImageProviderStore(),
        private readonly keyPath?: string,
    ) {}

    /** 列出当前用户可见的 Provider。 */
    async list(ownerUserId: number): Promise<TextToImageProviderDto[]> {
        const records = await this.store.findMany(ownerUserId);
        return records.map((record) => toDto(record));
    }

    /** 创建 Provider，并在进入存储前密封凭据。 */
    async create(ownerUserId: number, input: TextToImageProviderCreateInput): Promise<TextToImageProviderDto> {
        const parsed = TextToImageProviderCreateSchema.parse(input);
        const baseUrl = normalizeBaseUrl(parsed.kind, parsed.baseUrl, parsed.settings);
        const credential = await sealTextToImageCredential(parsed.credential, this.keyPath);
        const record = await this.store.create({
            ownerUserId,
            kind: parsed.kind,
            name: parsed.name,
            baseUrl,
            model: parsed.model,
            credentialCiphertext: credential.ciphertext,
            credentialIv: credential.iv,
            credentialTag: credential.tag,
            settings: parsed.settings,
        });
        return toDto(record);
    }

    /** 按 owner 更新 Provider；省略 credential 时保留现有密文。 */
    async update(ownerUserId: number, providerId: number, input: TextToImageProviderPatchInput): Promise<TextToImageProviderDto> {
        const parsed = TextToImageProviderPatchSchema.parse(input);
        const existing = await this.requireRecord(ownerUserId, providerId);
        const kind = parsed.kind ?? existing.kind;
        const settings = parsed.settings ?? existing.settings;
        const update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">> = {
            ...(parsed.kind === undefined ? {} : {kind: parsed.kind}),
            ...(parsed.name === undefined ? {} : {name: parsed.name}),
            ...(parsed.model === undefined ? {} : {model: parsed.model}),
            ...(parsed.settings === undefined ? {} : {settings: parsed.settings}),
            baseUrl: normalizeBaseUrl(kind, parsed.baseUrl ?? existing.baseUrl, settings),
        };
        if (parsed.credential !== undefined) {
            const credential = await sealTextToImageCredential(parsed.credential, this.keyPath);
            update.credentialCiphertext = credential.ciphertext;
            update.credentialIv = credential.iv;
            update.credentialTag = credential.tag;
        }
        const record = await this.store.update(ownerUserId, providerId, update);
        if (!record) {
            throw providerNotFoundError();
        }
        return toDto(record);
    }

    /** 删除当前用户拥有的 Provider。 */
    async delete(ownerUserId: number, providerId: number): Promise<void> {
        if (!await this.store.delete(ownerUserId, providerId)) {
            throw providerNotFoundError();
        }
    }

    /**
     * 为受信任的服务端调用解封凭据；调用方绝不能将返回值送回 HTTP 响应或任务 JSON。
     */
    async resolveCredential(ownerUserId: number, providerId: number): Promise<{
        provider: TextToImageProviderDto;
        credential: string;
    }> {
        const record = await this.requireRecord(ownerUserId, providerId);
        normalizeBaseUrl(record.kind, record.baseUrl, record.settings);
        if (!record.credentialCiphertext || !record.credentialIv || !record.credentialTag) {
            throw createError({statusCode: 400, message: "Provider 尚未配置凭据"});
        }
        return {
            provider: toDto(record),
            credential: await openTextToImageCredential({
                ciphertext: record.credentialCiphertext,
                iv: record.credentialIv,
                tag: record.credentialTag,
            }, this.keyPath),
        };
    }

    private async requireRecord(ownerUserId: number, providerId: number): Promise<TextToImageProviderRecord> {
        const record = await this.store.find(ownerUserId, providerId);
        if (!record) {
            throw providerNotFoundError();
        }
        return record;
    }
}

class PrismaTextToImageProviderStore implements TextToImageProviderStore {
    async create(record: Omit<TextToImageProviderRecord, "id" | "createdAt" | "updatedAt">): Promise<TextToImageProviderRecord> {
        return toRecord(await prisma.textToImageProvider.create({
            data: {
                owner: {connect: {id: record.ownerUserId}},
                kind: record.kind,
                name: record.name,
                baseUrl: record.baseUrl,
                model: record.model,
                credentialCiphertext: record.credentialCiphertext,
                credentialIv: record.credentialIv,
                credentialTag: record.credentialTag,
                settings: record.settings,
            },
        }));
    }

    async findMany(ownerUserId: number): Promise<TextToImageProviderRecord[]> {
        const records = await prisma.textToImageProvider.findMany({
            where: {ownerUserId},
            orderBy: {id: "asc"},
        });
        return records.map((record) => toRecord(record));
    }

    async find(ownerUserId: number, id: number): Promise<TextToImageProviderRecord | null> {
        const record = await prisma.textToImageProvider.findFirst({
            where: {id, ownerUserId},
        });
        return record ? toRecord(record) : null;
    }

    async update(ownerUserId: number, id: number, update: Partial<Omit<TextToImageProviderRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt">>): Promise<TextToImageProviderRecord | null> {
        const result = await prisma.textToImageProvider.updateMany({
            where: {id, ownerUserId},
            data: update,
        });
        if (result.count !== 1) {
            return null;
        }
        return await this.find(ownerUserId, id);
    }

    async delete(ownerUserId: number, id: number): Promise<boolean> {
        const result = await prisma.textToImageProvider.deleteMany({
            where: {id, ownerUserId},
        });
        return result.count === 1;
    }
}

function toRecord(record: TextToImageProvider): TextToImageProviderRecord {
    return {
        id: record.id,
        ownerUserId: record.ownerUserId,
        kind: record.kind as TextToImageProviderKind,
        name: record.name,
        baseUrl: record.baseUrl,
        model: record.model,
        credentialCiphertext: record.credentialCiphertext,
        credentialIv: record.credentialIv,
        credentialTag: record.credentialTag,
        settings: TextToImageProviderSettingsSchema.parse(record.settings),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toDto(record: TextToImageProviderRecord): TextToImageProviderDto {
    return {
        id: record.id,
        kind: record.kind,
        name: record.name,
        baseUrl: record.baseUrl,
        model: record.model,
        settings: record.settings,
        hasCredential: Boolean(record.credentialCiphertext && record.credentialIv && record.credentialTag),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

function normalizeBaseUrl(kind: TextToImageProviderKind, value: string, settings: TextToImageProviderSettings): string {
    if (kind === "novelai") {
        return TEXT_TO_IMAGE_NOVELAI_BASE_URL;
    }
    const url = assertTextToImageProviderUrl(value, settings);
    return url.pathname === "/" && !url.search ? url.origin : url.toString().replace(/\/+$/u, "");
}

function providerNotFoundError() {
    return createError({statusCode: 404, message: "Provider 不存在"});
}
