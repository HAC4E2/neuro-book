import type {Prisma} from "nbook/server/generated/prisma/client";
import type {TextToImageProviderKind} from "nbook/shared/dto/text-to-image.dto";
import {prisma} from "nbook/server/utils/prisma";
import {
    openTextToImageCredential,
    sealTextToImageCredential,
} from "nbook/server/text-to-image/provider-credential";
import {
    TextToImageNovelAiGenerationRecipeGroupSchema,
    TextToImageNovelAiGenerationRecipeMetaSchema,
    TextToImageNovelAiGenerationRecipeSchema,
    TextToImageNovelAiProfileSchema,
    TextToImageNovelAiSettingsSchema,
} from "nbook/shared/dto/text-to-image.dto";

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
    settings?: Record<string, unknown>;
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

export class TextToImageNovelAiProviderMissingError extends Error {
    readonly code = "TEXT_TO_IMAGE_NOVELAI_PROVIDER_MISSING";

    constructor() {
        super("请先在文生图工作台配置 NovelAI");
        this.name = "TextToImageNovelAiProviderMissingError";
    }
}

export class TextToImageNovelAiCredentialMissingError extends Error {
    readonly code = "TEXT_TO_IMAGE_NOVELAI_CREDENTIAL_MISSING";

    constructor() {
        super("请先保存 NovelAI API Key");
        this.name = "TextToImageNovelAiCredentialMissingError";
    }
}

/** 活动画风串为空、悬空或不属于当前 NovelAI Provider。 */
export class TextToImageGenerationRecipeNotConfiguredError extends Error {
    readonly code = "TEXT_TO_IMAGE_GENERATION_RECIPE_NOT_CONFIGURED";

    constructor() {
        super("请先选择并保存一个画风串");
        this.name = "TextToImageGenerationRecipeNotConfiguredError";
    }
}

export type TextToImageCredentialUpdate =
    | {mode: "preserve"}
    | {mode: "replace"; value: string}
    | {mode: "delete"};

export type SaveTextToImageProviderInput = {
    /** 更新已有 Provider 时必填；缺省时按 name 匹配。 */
    id?: number;
    kind: TextToImageProviderKind;
    name: string;
    baseUrl: string;
    model?: string | null;
    settings?: Record<string, unknown>;
    /** 严格的三态凭据合同；NovelAI 必须使用它，不允许空串承担隐式含义。 */
    credentialUpdate?: TextToImageCredentialUpdate;
    /** 兼容 OpenAI 兼容 Provider 的旧表单；非空表示替换，空值在已有 Provider 上表示保留。 */
    credential?: string;
};

export type CurrentNovelAiProviderSnapshot = {
    providerId: number;
    providerOwnerUserId: number;
    providerCredentialRevision: number;
    generationRecipeId: string;
    providerSnapshotJson: string;
};

export class TextToImageProviderCredentialRequiredError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_CREDENTIAL_REQUIRED";

    constructor() {
        super("新建文生图 Provider 必须提供真实 API Key。");
        this.name = "TextToImageProviderCredentialRequiredError";
    }
}

export class TextToImageProviderMaskSentinelError extends Error {
    readonly code = "TEXT_TO_IMAGE_PROVIDER_MASK_SENTINEL";

    constructor() {
        super("API Key 不能是遮罩字符；请粘贴真实 Key。");
        this.name = "TextToImageProviderMaskSentinelError";
    }
}

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
            : input.kind === "novelai"
                ? (await this.store.list(ownerUserId)).find((record) => record.kind === "novelai") ?? null
                : (await this.store.list(ownerUserId)).find((record) => record.name === input.name) ?? null;
        if (!existing && input.credentialUpdate?.mode !== "replace" && !(input.credential && input.credential.trim() !== "")) {
            throw new TextToImageProviderCredentialRequiredError();
        }
        const credentialChanged = await resolveCredentialChange(existing, input.credential, input.credentialUpdate, this.keyPath);
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
                ...(input.settings !== undefined ? {settings: input.settings} : {}),
                credentialCiphertext: sealed?.ciphertext ?? "",
                credentialIv: sealed?.iv ?? "",
                credentialTag: sealed?.tag ?? "",
                credentialRevision: revision,
            })
            : await this.store.create({
                ownerUserId,
                kind: input.kind,
                name: input.name,
                baseUrl: input.baseUrl,
                model: input.model ?? null,
                credentialCiphertext: sealed?.ciphertext ?? "",
                credentialIv: sealed?.iv ?? "",
                credentialTag: sealed?.tag ?? "",
                credentialRevision: revision,
                settings: input.settings ?? {},
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

    /** 只删除凭据，保留 Provider 与全部非敏感配置；revision 加一。 */
    async deleteCredential(ownerUserId: number, id: number): Promise<TextToImageProviderDto> {
        const record = await this.store.find(ownerUserId, id);
        if (!record) throw new TextToImageProviderNotConfiguredError();
        const updated = await this.store.update(ownerUserId, id, {
            credentialCiphertext: "",
            credentialIv: "",
            credentialTag: "",
            credentialRevision: record.credentialRevision + (hasCompleteCredential(record) ? 1 : 0),
        });
        if (!updated) throw new TextToImageProviderNotConfiguredError();
        return toProviderDto(updated);
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

    /** 返回运行直调所需的设置、明文凭据和 revision，供队列消费时校验。 */
    async resolveRuntimeProvider(ownerUserId: number, id: number): Promise<{settings: Record<string, unknown>; credential: string; credentialRevision: number}> {
        const record = await this.store.find(ownerUserId, id);
        if (!record) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return {
            settings: record.settings,
            credential: await this.resolveCredential(ownerUserId, id),
            credentialRevision: record.credentialRevision,
        };
    }

    /** 只切换活动画风串，绝不把当前表单中的其它草稿写回 Provider。 */
    async setActiveGenerationRecipe(ownerUserId: number, id: number, recipeId: string): Promise<TextToImageProviderDto> {
        const record = await this.store.find(ownerUserId, id);
        if (!record || record.kind !== "novelai") {
            throw new TextToImageProviderNotConfiguredError();
        }
        const settings = TextToImageNovelAiSettingsSchema.safeParse(record.settings);
        const recipes = settings.success ? settings.data.generationRecipes : readRecord(record.settings.generationRecipes);
        if (!recipes || !Object.prototype.hasOwnProperty.call(recipes, recipeId)) {
            throw new TextToImageGenerationRecipeNotConfiguredError();
        }
        const updated = await this.store.update(ownerUserId, id, {
            settings: {...record.settings, activeGenerationRecipeId: recipeId},
        });
        if (!updated) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return toProviderDto(updated);
    }

    /** 解析点击重 roll 时当前认证用户可用的 NovelAI Provider，不读取源 Job 的 Provider。 */
    async resolveCurrentNovelAiProvider(ownerUserId: number): Promise<CurrentNovelAiProviderSnapshot> {
        const provider = (await this.store.list(ownerUserId))
            .filter((record) => record.kind === "novelai")
            .sort((left, right) => left.id - right.id)[0];
        if (!provider) {
            throw new TextToImageNovelAiProviderMissingError();
        }
        const settings = sanitizeNovelAiProviderSettings(provider.settings);
        const activeRecipeId = typeof settings.activeGenerationRecipeId === "string"
            ? settings.activeGenerationRecipeId.trim()
            : "";
        const recipes = readRecord(settings.generationRecipes);
        if (activeRecipeId === "" || !recipes || !Object.prototype.hasOwnProperty.call(recipes, activeRecipeId)) {
            throw new TextToImageGenerationRecipeNotConfiguredError();
        }
        // 只为运行时确认 Key 存在；明文不进入返回值、Job 快照或错误消息。
        try {
            await this.resolveCredential(ownerUserId, provider.id);
        } catch (error) {
            if (error instanceof TextToImageProviderNotConfiguredError) {
                throw new TextToImageNovelAiCredentialMissingError();
            }
            throw error;
        }
        return {
            providerId: provider.id,
            providerOwnerUserId: ownerUserId,
            providerCredentialRevision: provider.credentialRevision,
            generationRecipeId: activeRecipeId,
            providerSnapshotJson: JSON.stringify({
                providerId: provider.id,
                kind: provider.kind,
                baseUrl: provider.baseUrl,
                model: provider.model,
                credentialRevision: provider.credentialRevision,
                activeGenerationRecipeId: activeRecipeId,
                // baseUrl 的权威字段在 Provider 记录本身；覆盖 settings 中可能过期的副本，
                // 让点击时快照连同当前出站地址一起冻结，但不携带凭据。
                settings: {...settings, baseUrl: provider.baseUrl},
            }),
        };
    }
}

/** Provider settings may come from older JSON; keep only the NovelAI contract before queueing. */
function sanitizeNovelAiProviderSettings(input: Record<string, unknown>): Record<string, unknown> {
    const nested = new Set([
        "profiles",
        "generationRecipes",
        "generationRecipeGroups",
        "generationRecipeMeta",
        "fixedPromptPresets",
    ]);
    const rootInput = Object.fromEntries(Object.entries(input).filter(([key]) => !nested.has(key)));
    const rootResult = TextToImageNovelAiSettingsSchema.partial().safeParse(rootInput);
    const settings: Record<string, unknown> = rootResult.success ? {...rootResult.data} : {};
    settings.profiles = sanitizeRecord(input.profiles, TextToImageNovelAiProfileSchema.partial());
    settings.generationRecipes = sanitizeRecord(input.generationRecipes, TextToImageNovelAiGenerationRecipeSchema.partial());
    settings.generationRecipeGroups = sanitizeRecord(input.generationRecipeGroups, TextToImageNovelAiGenerationRecipeGroupSchema.partial());
    settings.generationRecipeMeta = sanitizeRecord(input.generationRecipeMeta, TextToImageNovelAiGenerationRecipeMetaSchema.partial());
    settings.fixedPromptPresets = sanitizePromptPresets(input.fixedPromptPresets);
    return settings;
}

function sanitizeRecord(value: unknown, schema: {safeParse: (input: unknown) => {success: boolean; data?: unknown}}): Record<string, unknown> {
    const record = readRecord(value);
    if (!record) return {};
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => {
        const parsed = schema.safeParse(item);
        return parsed.success ? [[key, parsed.data]] : [];
    }));
}

function sanitizePromptPresets(value: unknown): Record<string, unknown> {
    const record = readRecord(value);
    if (!record) return {};
    return Object.fromEntries(Object.entries(record).flatMap(([key, item]) => {
        const valueRecord = readRecord(item);
        if (!valueRecord) return [];
        return [[key, {
            positive: typeof valueRecord.positive === "string" ? valueRecord.positive : "",
            positiveEnd: typeof valueRecord.positiveEnd === "string" ? valueRecord.positiveEnd : "",
            negative: typeof valueRecord.negative === "string" ? valueRecord.negative : "",
        }]];
    }));
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

type ResolvedCredentialChange = {
    sealed: {ciphertext: string; iv: string; tag: string} | null;
    changed: boolean;
};

async function resolveCredentialChange(
    existing: TextToImageProviderRecord | null,
    credential: string | undefined,
    credentialUpdate: TextToImageCredentialUpdate | undefined,
    keyPath: string | undefined,
): Promise<ResolvedCredentialChange> {
    const mode = credentialUpdate?.mode ?? (credential && credential.trim() !== "" ? "replace" : "preserve");
    if (mode === "delete") {
        if (!existing || !hasCompleteCredential(existing)) {
            throw new TextToImageProviderNotConfiguredError();
        }
        return {sealed: null, changed: true};
    }
    if (mode === "replace") {
        const value = (credentialUpdate?.mode === "replace" ? credentialUpdate.value : credential) ?? "";
        assertValidCredentialValue(value);
        if (existing && hasCompleteCredential(existing)) {
            const previous = await openTextToImageCredential({
                ciphertext: existing.credentialCiphertext,
                iv: existing.credentialIv,
                tag: existing.credentialTag,
            }, keyPath).catch(() => "");
            if (previous === value) {
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
            sealed: await sealTextToImageCredential(value, keyPath),
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

function assertValidCredentialValue(value: string): void {
    const normalized = value.trim();
    if (normalized === "") {
        throw new TextToImageProviderCredentialRequiredError();
    }
    if (/^[\s·•*●]+$/u.test(normalized) || normalized.startsWith("····")) {
        throw new TextToImageProviderMaskSentinelError();
    }
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
