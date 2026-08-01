import {randomUUID} from "node:crypto";
import {z} from "zod";
import {
    CharacterVisualDirectorOutputSchema,
    CharacterVisualDirectWriteRequestSchema,
    CharacterVisualDirectWriteResultSchema,
    type CharacterVisualDirectorOutput,
    type CharacterVisualDirectWriteErrorCode,
    type CharacterVisualDirectWriteRequest,
    type CharacterVisualDirectWriteResult,
} from "nbook/shared/text-to-image-character-direct-write";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";
import {
    CharacterVisualMaterializationError,
    normalizeOutfitFileStem,
} from "nbook/server/text-to-image/character-visual-materializer";

const JOURNAL_ROOT = ".nbook/text-to-image/character-visual-direct-write";
const JOURNAL_VERSION = "nbook.character-visual-direct-write/v1" as const;

const JournalTargetSchema = z.object({
    path: z.string().trim().min(1).max(500),
    priorContent: z.string().max(5 * 1024 * 1024).nullable(),
    priorHash: z.string().nullable(),
    targetContent: z.string().max(5 * 1024 * 1024),
    targetHash: z.string(),
    state: z.enum(["pending", "written"]),
}).strict();

const JournalResultSchema = CharacterVisualDirectWriteResultSchema;
const JournalSchema = z.object({
    schemaVersion: z.literal(JOURNAL_VERSION),
    state: z.enum(["created", "running", "result_ready", "prepared", "completed", "blocked", "stale", "failed"]),
    projectPath: z.string().trim().min(1).max(500),
    characterPath: z.string().trim().min(1).max(500),
    characterId: z.string().trim().min(1).max(160),
    sourceCharacterFileHash: z.string(),
    sourceCharacterMarkdown: z.string().max(5 * 1024 * 1024),
    idempotencyKey: z.string().uuid(),
    operationId: z.string().trim().min(1).max(200),
    sessionAcquisitionTag: z.string().trim().min(1).max(500),
    clientMessageId: z.string().trim().min(1).max(500),
    sessionId: z.number().int().positive().nullable(),
    invocationId: z.string().trim().min(1).max(200).nullable(),
    directorOutput: CharacterVisualDirectorOutputSchema.nullable(),
    targets: z.array(JournalTargetSchema).max(65),
    diagnostics: z.array(z.object({
        code: z.literal("TAG_REVIEW_EXCLUDED"),
        owner: z.string(),
        field: z.string(),
        sourceText: z.string(),
        message: z.string(),
    }).strict()).max(256),
    result: JournalResultSchema.nullable(),
}).strict();
type Journal = z.infer<typeof JournalSchema>;

type DurableResult =
    | {state: "missing"}
    | {state: "active"; invocationId: string; lifecycle: "accepted" | "running"; executionLeaseUntil: string}
    | {state: "orphaned"; invocationId: string; lifecycle: "accepted" | "running"; providerStartRecorded: boolean | null}
    | {state: "waiting"; invocationId: string}
    | {state: "failed"; invocationId: string; errorInfo: {message?: string} | null}
    | {state: "completed_without_result"; invocationId: string}
    | {
        state: "completed";
        invocationId: string;
        /** Harness report_result 属于外部持久化 JSON 边界，必须由 shared strict schema 收窄。 */
        reportResult: unknown;
    };

/** Service 读取到的 Project 角色视觉快照；所有文本均为未经重排的原始字节字符串。 */
export type CharacterVisualDirectWriteSnapshot = {
    root: string;
    characterId: string;
    characterPath: string;
    sourceMarkdown: string | null;
    characterImageTags: string | null;
    referencedOutfits: Array<{path: string; content: string}>;
};

/** materializer 完整完成 resolver、render 与 round-trip 后交给 journal 的写入目标。 */
export type CharacterVisualDirectWriteMaterialization = {
    characterMarkdown: string;
    outfits: Array<{path: string; content: string}>;
    diagnostics: Array<{code: "TAG_REVIEW_EXCLUDED"; owner: string; field: string; sourceText: string; message: string}>;
};

/** 把可替换 I/O 收束到 runtime，保证 service 可用内存 store 测试全部崩溃窗口。 */
export type CharacterVisualDirectWriteRuntime = {
    read(path: string): Promise<string | null>;
    write(input: {path: string; content: string; knownBefore: string | null}): Promise<void>;
    snapshot(input: {projectPath: string; characterPath: string}): Promise<CharacterVisualDirectWriteSnapshot>;
    acquire(input: {
        projectPath: string;
        characterPath: string;
        characterMarkdown: string;
        sourceCharacterFileHash: string;
        acquisitionTag: string;
    }): Promise<{sessionId: number}>;
    resolve(input: {sessionId: number; clientMessageId: string}): Promise<DurableResult>;
    start(input: {
        sessionId: number;
        clientMessageId: string;
        projectPath: string;
        characterPath: string;
        characterMarkdown: string;
        sourceCharacterFileHash: string;
        onAccepted(input: {sessionId: number; invocationId: string; clientMessageId: string}): Promise<void>;
    }): Promise<void>;
    materialize(input: {
        runId: string;
        snapshot: CharacterVisualDirectWriteSnapshot;
        output: CharacterVisualDirectorOutput;
    }): Promise<CharacterVisualDirectWriteMaterialization>;
    isDirectorConfigured?(): Promise<boolean>;
    sleep(ms: number): Promise<void>;
    now(): number;
    invalidate(): void;
};

/** 供 HTTP 层按共享 error-code contract 映射的业务错误。 */
export class CharacterVisualDirectWriteError extends Error {
    readonly code: CharacterVisualDirectWriteErrorCode;

    constructor(code: CharacterVisualDirectWriteErrorCode, message: string) {
        super(message);
        this.name = "CharacterVisualDirectWriteError";
        this.code = code;
    }
}

type ServiceOptions = {
    waitBudgetMs?: number;
    pollIntervalMs?: number;
};

/** Project-owned journal 状态机：不在模型推理或轮询期间持有进程内 mutation lock。 */
export class CharacterVisualDirectWriteService {
    private readonly tails = new Map<string, Promise<void>>();
    private readonly waitBudgetMs: number;
    private readonly pollIntervalMs: number;

    constructor(
        private readonly runtime: CharacterVisualDirectWriteRuntime,
        options: ServiceOptions = {},
    ) {
        this.waitBudgetMs = options.waitBudgetMs ?? 30_000;
        this.pollIntervalMs = options.pollIntervalMs ?? 250;
    }

    /** 从请求身份定位同一 journal，并在每次恢复前重新读取 durable Harness 真相。 */
    async generate(inputValue: z.input<typeof CharacterVisualDirectWriteRequestSchema>): Promise<CharacterVisualDirectWriteResult> {
        const input = CharacterVisualDirectWriteRequestSchema.parse(inputValue);
        if (this.runtime.isDirectorConfigured && !await this.runtime.isDirectorConfigured()) {
            throw new CharacterVisualDirectWriteError("ILLUSTRATION_DIRECTOR_MODEL_NOT_CONFIGURED", "illustration.director 尚未配置模型");
        }
        const journalPath = this.journalPath(input.idempotencyKey);
        let journal = await this.withLock(journalPath, () => this.loadOrCreate(input, journalPath));
        if (journal.state === "completed") return requireResult(journal);
        if (journal.state === "blocked") throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_POLICY_BLOCKED", "角色事实不足或 Tag Policy 已阻止写入");
        if (journal.state === "stale") throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_TARGET_STALE", "角色视觉目标已变化");
        if (journal.state === "failed") throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "角色视觉 Director 调用失败");

        if (journal.state === "prepared") {
            return this.withLock(journalPath, () => this.writePrepared(journalPath, journal));
        }

        journal = await this.ensureSession(journalPath, journal);
        const durable = await this.runtime.resolve({sessionId: requireSessionId(journal), clientMessageId: journal.clientMessageId});
        const output = await this.resolveDirector(journalPath, journal, durable);
        if (output === null) {
            const completed = await this.withLock(journalPath, async () => requireJournal(await this.runtime.read(journalPath)));
            if (completed.state === "completed") return requireResult(completed);
            throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_POLICY_BLOCKED", "角色视觉 Director 已阻止写入");
        }
        return this.withLock(journalPath, () => this.prepareAndWrite(journalPath, output));
    }

    /** journal 首次落盘前冻结 source 与所有现有 V2 outfit 原始内容。 */
    private async loadOrCreate(input: CharacterVisualDirectWriteRequest, journalPath: string): Promise<Journal> {
        const raw = await this.runtime.read(journalPath);
        if (raw !== null) {
            const journal = parseJournal(raw);
            if (journal.projectPath !== input.projectPath
                || journal.characterPath !== input.characterPath
                || journal.sourceCharacterFileHash !== input.sourceCharacterFileHash
                || journal.idempotencyKey !== input.idempotencyKey) {
                throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_OPERATION_CONFLICT", "同一幂等键已绑定到另一角色视觉操作");
            }
            return journal;
        }
        const snapshot = await this.runtime.snapshot(input);
        if (snapshot.characterPath !== input.characterPath || snapshot.sourceMarkdown === null
            || createTextToImageFileHash(snapshot.sourceMarkdown) !== input.sourceCharacterFileHash) {
            throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_SOURCE_STALE", "角色 index.md 已在请求前变化");
        }
        const operationId = `character-visual-${randomUUID()}`;
        const journal = JournalSchema.parse({
            schemaVersion: JOURNAL_VERSION,
            state: "created",
            projectPath: input.projectPath,
            characterPath: input.characterPath,
            characterId: snapshot.characterId,
            sourceCharacterFileHash: input.sourceCharacterFileHash,
            sourceCharacterMarkdown: snapshot.sourceMarkdown,
            idempotencyKey: input.idempotencyKey,
            operationId,
            sessionAcquisitionTag: `character-visual-direct-write:${input.idempotencyKey}`,
            clientMessageId: `character-visual-direct-write:${input.idempotencyKey}`,
            sessionId: null,
            invocationId: null,
            directorOutput: null,
            targets: [
                freezeTarget("lorebook/character/" + snapshot.characterId + "/image-tags.md", snapshot.characterImageTags),
                ...snapshot.referencedOutfits.map((item) => freezeTarget(item.path, item.content)),
            ],
            diagnostics: [],
            result: null,
        });
        await this.runtime.write({path: journalPath, content: renderJournal(journal), knownBefore: null});
        return journal;
    }

    /** acquisitionTag 是 session 身份真相；未写回 sessionId 的崩溃恢复会安全地再次 acquire。 */
    private async ensureSession(journalPath: string, journal: Journal): Promise<Journal> {
        if (journal.sessionId !== null) return journal;
        const acquired = await this.runtime.acquire({
            projectPath: journal.projectPath,
            characterPath: journal.characterPath,
            characterMarkdown: journal.sourceCharacterMarkdown,
            sourceCharacterFileHash: journal.sourceCharacterFileHash,
            acquisitionTag: journal.sessionAcquisitionTag,
        });
        return this.withLock(journalPath, async () => {
            const current = requireJournal(await this.runtime.read(journalPath));
            if (current.sessionId !== null) return current;
            const next = JournalSchema.parse({...current, sessionId: acquired.sessionId});
            await this.replaceJournal(journalPath, current, next);
            return next;
        });
    }

    /** durable result 是唯一 invocation authority；journal admission 仅记录恢复定位信息。 */
    private async resolveDirector(journalPath: string, journal: Journal, initial: DurableResult): Promise<CharacterVisualDirectorOutput | null> {
        let durable = initial;
        if (durable.state === "missing" && journal.invocationId === null) {
            try {
                await this.runtime.start({
                    sessionId: requireSessionId(journal),
                    clientMessageId: journal.clientMessageId,
                    projectPath: journal.projectPath,
                    characterPath: journal.characterPath,
                    characterMarkdown: journal.sourceCharacterMarkdown,
                    sourceCharacterFileHash: journal.sourceCharacterFileHash,
                    onAccepted: async (accepted) => this.withLock(journalPath, async () => {
                        const current = requireJournal(await this.runtime.read(journalPath));
                        if (current.invocationId !== null && current.invocationId !== accepted.invocationId) {
                            throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_OPERATION_CONFLICT", "journal 已记录其他 Director invocation");
                        }
                        const next = JournalSchema.parse({...current, state: "running", sessionId: accepted.sessionId, invocationId: accepted.invocationId});
                        await this.replaceJournal(journalPath, current, next);
                    }),
                });
            } catch (error) {
                durable = await this.runtime.resolve({sessionId: requireSessionId(journal), clientMessageId: journal.clientMessageId});
                if (durable.state === "missing") throw error;
            }
        }
        while (true) {
            const current = requireJournal(await this.runtime.read(journalPath));
            durable = await this.runtime.resolve({sessionId: requireSessionId(current), clientMessageId: current.clientMessageId});
            if (durable.state === "active") {
                const deadline = this.runtime.now() + this.waitBudgetMs;
                while (this.runtime.now() < deadline) {
                    const remaining = deadline - this.runtime.now();
                    await this.runtime.sleep(Math.min(this.pollIntervalMs, remaining));
                    durable = await this.runtime.resolve({sessionId: requireSessionId(current), clientMessageId: current.clientMessageId});
                    if (durable.state !== "active") break;
                }
                if (durable.state === "active") {
                    throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_OPERATION_RUNNING", "角色视觉 Director 仍在运行；请使用同一幂等键重试");
                }
            }
            if (durable.state === "completed") {
                const parsed = CharacterVisualDirectorOutputSchema.safeParse(durable.reportResult);
                if (!parsed.success || parsed.data.sourceCharacterFileHash !== current.sourceCharacterFileHash) {
                    await this.mark(journalPath, current, "failed");
                    throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_OUTPUT_INVALID", "illustration.director 输出不符合当前角色视觉 contract");
                }
                if (parsed.data.state === "blocked") {
                    await this.mark(journalPath, current, "blocked");
                    return null;
                }
                const next = JournalSchema.parse({...current, state: "result_ready", invocationId: durable.invocationId, directorOutput: parsed.data});
                await this.replaceJournal(journalPath, current, next);
                return parsed.data;
            }
            if (durable.state === "orphaned") {
                await this.mark(journalPath, current, "failed");
                throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_INVOCATION_ORPHANED", "角色视觉 Director invocation 已失去执行租约");
            }
            if (durable.state === "missing") {
                const code = current.invocationId === null ? "CHARACTER_VISUAL_DIRECTOR_FAILED" : "CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING";
                await this.mark(journalPath, current, "failed");
                throw new CharacterVisualDirectWriteError(code, "角色视觉 Director durable invocation 缺失");
            }
            await this.mark(journalPath, current, "failed");
            throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", `角色视觉 Director 未返回可写入结果：${durable.state}`);
        }
    }

    /** prepare 前重新冻结 source 与每个 target，materializer 不具有任何文件写入能力。 */
    private async prepareAndWrite(journalPath: string, output: CharacterVisualDirectorOutput): Promise<CharacterVisualDirectWriteResult> {
        const journal = requireJournal(await this.runtime.read(journalPath));
        const snapshot = await this.runtime.snapshot({projectPath: journal.projectPath, characterPath: journal.characterPath});
        if (snapshot.sourceMarkdown === null || createTextToImageFileHash(snapshot.sourceMarkdown) !== journal.sourceCharacterFileHash) {
            await this.mark(journalPath, journal, "stale");
            throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_SOURCE_STALE", "角色 index.md 在 Director 执行期间变化");
        }
        let materialized: CharacterVisualDirectWriteMaterialization;
        try {
            materialized = await this.runtime.materialize({runId: journal.operationId, snapshot, output});
        } catch (error) {
            if (error instanceof CharacterVisualMaterializationError) {
                await this.mark(journalPath, journal, error.code === "CHARACTER_VISUAL_POLICY_BLOCKED" ? "blocked" : "failed");
                throw new CharacterVisualDirectWriteError(error.code, error.message);
            }
            throw error;
        }
        const generated = new Set(output.outfits.map((item) => `lorebook/character/${journal.characterId}/outfits/${normalizeOutfitFileStem(item.names)}.md`));
        const outfits = materialized.outfits.filter((item) => generated.has(item.path)).sort((left, right) => left.path.localeCompare(right.path));
        const requestedTargets = [
            {path: `lorebook/character/${journal.characterId}/image-tags.md`, content: materialized.characterMarkdown},
            ...outfits,
        ];
        const prior = new Map(journal.targets.map((target) => [target.path, target]));
        const targets: z.input<typeof JournalTargetSchema>[] = [];
        for (const item of requestedTargets) {
            const existing = prior.get(item.path);
            const current = await this.runtime.read(item.path);
            if (existing && current !== existing.priorContent) {
                await this.mark(journalPath, journal, "stale");
                throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_TARGET_STALE", `角色视觉目标已变化：${item.path}`);
            }
            targets.push({
                path: item.path,
                priorContent: existing?.priorContent ?? current,
                priorHash: existing?.priorHash ?? optionalHash(current),
                targetContent: item.content,
                targetHash: createTextToImageFileHash(item.content),
                state: "pending",
            });
        }
        const next = JournalSchema.parse({...journal, state: "prepared", directorOutput: output, targets, diagnostics: materialized.diagnostics});
        await this.replaceJournal(journalPath, journal, next);
        return this.writePrepared(journalPath, next);
    }

    /** outfits 先按 path 稳定写入，最后写 image-tags，崩溃时只接受 prior 或精确 target bytes。 */
    private async writePrepared(journalPath: string, initial: Journal): Promise<CharacterVisualDirectWriteResult> {
        let journal = initial;
        const writes = [...journal.targets].sort((left, right) => {
            const leftCharacter = left.path.endsWith("/image-tags.md");
            const rightCharacter = right.path.endsWith("/image-tags.md");
            if (leftCharacter !== rightCharacter) return leftCharacter ? 1 : -1;
            return left.path.localeCompare(right.path);
        });
        for (const target of writes) {
            const current = await this.runtime.read(target.path);
            if (current === target.targetContent) {
                if (target.state !== "written") journal = await this.markWrite(journalPath, journal, target.path);
                continue;
            }
            if (current !== target.priorContent) {
                await this.mark(journalPath, journal, "stale");
                throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_TARGET_STALE", `恢复目标不是 prior 或 target bytes：${target.path}`);
            }
            await this.runtime.write({path: target.path, content: target.targetContent, knownBefore: current});
            journal = await this.markWrite(journalPath, journal, target.path);
        }
        const result = CharacterVisualDirectWriteResultSchema.parse({
            state: "completed",
            operationId: journal.operationId,
            sessionId: requireSessionId(journal),
            invocationId: requireInvocationId(journal),
            characterImageTagsPath: `lorebook/character/${journal.characterId}/image-tags.md`,
            outfitPaths: writes.filter((item) => !item.path.endsWith("/image-tags.md")).map((item) => item.path),
            diagnostics: journal.diagnostics,
            fileHashes: Object.fromEntries(writes.map((item) => [item.path, item.targetHash])),
        });
        const completed = JournalSchema.parse({...journal, state: "completed", result});
        await this.replaceJournal(journalPath, journal, completed);
        this.runtime.invalidate();
        return result;
    }

    private async markWrite(journalPath: string, journal: Journal, path: string): Promise<Journal> {
        const current = requireJournal(await this.runtime.read(journalPath));
        const next = JournalSchema.parse({...current, targets: current.targets.map((item) => item.path === path ? {...item, state: "written"} : item)});
        await this.replaceJournal(journalPath, current, next);
        return next;
    }

    private async mark(journalPath: string, journal: Journal, state: Journal["state"]): Promise<void> {
        const current = requireJournal(await this.runtime.read(journalPath));
        if (current.state === state) return;
        await this.replaceJournal(journalPath, current, JournalSchema.parse({...current, state}));
    }

    private async replaceJournal(journalPath: string, before: Journal, after: Journal): Promise<void> {
        const current = await this.runtime.read(journalPath);
        const expected = renderJournal(before);
        if (current !== expected) throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_TARGET_STALE", "direct-write journal 已被并发修改");
        await this.runtime.write({path: journalPath, content: renderJournal(after), knownBefore: current});
    }

    private journalPath(idempotencyKey: string): string {
        return `${JOURNAL_ROOT}/${idempotencyKey}/journal.json`;
    }

    private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const tail = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.then(() => tail);
        this.tails.set(key, queued);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.tails.get(key) === queued) this.tails.delete(key);
        }
    }
}

function freezeTarget(path: string, content: string | null): z.input<typeof JournalTargetSchema> {
    return {path, priorContent: content, priorHash: optionalHash(content), targetContent: "", targetHash: "", state: "pending"};
}

function optionalHash(content: string | null): string | null {
    return content === null ? null : createTextToImageFileHash(content);
}

function renderJournal(journal: Journal): string {
    return `${JSON.stringify(journal, null, 2)}\n`;
}

function parseJournal(raw: string): Journal {
    try {
        return JournalSchema.parse(JSON.parse(raw));
    } catch {
        throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "direct-write journal 已损坏");
    }
}

function requireJournal(raw: string | null): Journal {
    if (raw === null) throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "direct-write journal 丢失");
    return parseJournal(raw);
}

function requireSessionId(journal: Journal): number {
    if (journal.sessionId === null) throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "direct-write journal 缺少 Session");
    return journal.sessionId;
}

function requireInvocationId(journal: Journal): string {
    if (journal.invocationId === null) throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "direct-write journal 缺少 invocation");
    return journal.invocationId;
}

function requireResult(journal: Journal): CharacterVisualDirectWriteResult {
    if (journal.result === null) throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_DIRECTOR_FAILED", "completed journal 缺少结果");
    return journal.result;
}
