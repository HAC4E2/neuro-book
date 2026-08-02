import {createHash} from "node:crypto";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {loadEffectiveConfig, loadEffectiveConfigForAgentRuntime} from "nbook/server/config/config-service";
import {useAgentHarness} from "nbook/server/agent/http";
import {ILLUSTRATION_DIRECTOR_PROFILE_KEY} from "nbook/shared/agent/illustration-director";
import type {CharacterVisualDirectorOutput} from "nbook/shared/text-to-image-character-direct-write";
import {materializeCharacterVisualDirect} from "nbook/server/text-to-image/character-visual-materializer";
import {
    parseCharacterImageTagsMarkdown,
    parseOutfitTagsMarkdown,
    renderCharacterImageTagsMarkdown,
    renderOutfitTagsMarkdown,
} from "nbook/server/text-to-image/character-visual.codec";
import {
    TagIndexReader,
} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";
import {absoluteFsPath, invalidateProjectTreeIndex, resolveWorkspaceRootInput, textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {assertProjectOpen} from "nbook/server/workspace-files/project-session";
import type {InvocationLifecycleEntry, SessionEntry} from "nbook/server/agent/session/types";
import {readWorkspaceTextFile} from "nbook/server/workspace-files/workspace-files";
import {
    TrackedWorkspaceFileConflictError,
    USER_LOCAL_ACTOR,
    writeResolvedProjectTextFileTracked,
} from "nbook/server/workspace-history/tracked-workspace-files";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    CharacterVisualDirectWriteError,
} from "nbook/server/text-to-image/character-visual-direct-write.service";
import type {
    CharacterVisualDirectWriteMaterialization,
    CharacterVisualDirectWriteRuntime,
    CharacterVisualDirectWriteSnapshot,
} from "nbook/server/text-to-image/character-visual-direct-write.service";

/** 建立绑定到单个已打开 Project 的 direct-write runtime；service 不持有任何全局文件状态。 */
export async function createCharacterVisualDirectWriteRuntime(projectPath: string): Promise<CharacterVisualDirectWriteRuntime> {
    assertProjectOpen(textToImageProjectRef(projectPath));
    const projectRoot = projectRootFromPath(projectPath);
    const effective = await loadEffectiveConfig({workspaceKind: "novel", projectRoot});
    const indexStore = new TagIndexStore();
    const resolver = new TagResolverService({
        reader: new TagIndexReader({root: indexStore.root}),
        policyRegistry: new TagPolicyRegistryService(),
        capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
        resolveProjectPolicy: async () => effective.illustration.tagPolicy,
    });
    return new WorkspaceCharacterVisualDirectWriteRuntime(projectPath, resolver);
}

/** Project file/Harness 副作用实现；每个方法都重新断言 Project open，避免关闭后继续写入。 */
class WorkspaceCharacterVisualDirectWriteRuntime implements CharacterVisualDirectWriteRuntime {
    constructor(
        private readonly projectPath: string,
        private readonly resolver: TagResolverService,
    ) {}

    /** 读取可选文本文件；不存在时返回 null，其他 containment/编码错误照常上抛。 */
    async read(filePath: string): Promise<string | null> {
        const root = await this.root();
        try {
            return await readWorkspaceTextFile(root, filePath);
        } catch (error) {
            if (isNotFoundError(error)) return null;
            throw error;
        }
    }

    /** 使用 Project tracked writer 落盘；service 已在调用前比较 knownBefore 形成 CAS 前置条件。 */
    async write(input: {path: string; content: string; knownBefore: string | null}): Promise<void> {
        const root = await this.root();
        try {
            await writeResolvedProjectTextFileTracked({
                projectPath: this.projectPath,
                projectRoot: root,
                filePath: input.path,
                content: input.content,
                knownBefore: input.knownBefore,
                actor: USER_LOCAL_ACTOR,
            });
        } catch (error) {
            if (error instanceof TrackedWorkspaceFileConflictError) {
                throw new CharacterVisualDirectWriteError("CHARACTER_VISUAL_TARGET_STALE", `角色视觉目标在最终写入前变化：${input.path}`);
            }
            throw error;
        }
    }

    /** 冻结 index、原 image-tags 与所有被有效 V2 character 文档引用的有效 V2 outfits。 */
    async snapshot(input: {projectPath: string; characterPath: string}): Promise<CharacterVisualDirectWriteSnapshot> {
        if (input.projectPath !== this.projectPath) throw new Error("direct-write runtime 不能跨 Project 使用");
        const root = await this.root();
        const sourceMarkdown = await this.read(input.characterPath);
        const characterId = characterIdFromPath(input.characterPath);
        const imagePath = `lorebook/character/${characterId}/image-tags.md`;
        const characterImageTags = await this.read(imagePath);
        const referencedOutfits: Array<{path: string; content: string}> = [];
        if (characterImageTags !== null) {
            try {
                const parsed = parseCharacterImageTagsMarkdown(characterImageTags).character;
                if (parsed.characterId === characterId) {
                    for (const ref of parsed.outfitRefs) {
                        const path = `lorebook/character/${characterId}/${ref}`;
                        const content = await this.read(path);
                        if (content === null) continue;
                        try {
                            const outfit = parseOutfitTagsMarkdown(content).outfit;
                            if (outfit.ownerCharacterId === characterId && outfit.outfitId === ref.slice("outfits/".length, -".md".length)) {
                                referencedOutfits.push({path, content});
                            }
                        } catch {
                            // 无效或不属于当前角色的 outfit 不进入可保留 V2 集合。
                        }
                    }
                }
            } catch {
                // 旧格式 image-tags 不是 V2 既有资产；direct materializer 将从 null 开始构建。
            }
        }
        return {root, characterId, characterPath: input.characterPath, sourceMarkdown, characterImageTags, referencedOutfits};
    }

    /** acquisitionTag 使 Session create/writeback 崩溃后仍可重取同一 Session；按 (profile, projectRoot, tag) 幂等复用。 */
    async acquire(input: {
        projectPath: string;
        characterPath: string;
        characterMarkdown: string;
        sourceCharacterFileHash: string;
        acquisitionTag: string;
    }): Promise<{sessionId: number}> {
        const harness = useAgentHarness();
        const profileKey = ILLUSTRATION_DIRECTOR_PROFILE_KEY;
        const initial: JsonValue = {
            operation: "generate-character-visual",
            characterPath: input.characterPath,
            characterMarkdown: input.characterMarkdown,
            sourceCharacterFileHash: input.sourceCharacterFileHash,
        };
        const profile = await harness.profiles.get(profileKey);
        const parsedInitial = harness.profiles.parseInitial(profile, initial);
        const projectRoot = projectRootFromPath(input.projectPath);
        const summaries = await harness.listSessions({profileKey, scope: "project", projectRoot, includeSystem: true});
        for (const summary of summaries) {
            const snapshot = await harness.repo.readSession(summary.sessionId);
            const metadata = snapshot.metadata;
            if (metadata.profileKey !== profileKey || metadata.currentProjectRoot !== projectRoot) continue;
            if (!metadata.tags?.includes(input.acquisitionTag)) continue;
            if (stableJsonHash(metadata.initial) !== stableJsonHash(parsedInitial)) {
                throw new Error(`acquisition identity 与 Initial 冲突：${input.acquisitionTag}`);
            }
            return {sessionId: metadata.sessionId};
        }
        const created = await harness.createAgent({
            profileKey,
            initial: parsedInitial,
            currentProjectRoot: projectRoot,
            tags: [input.acquisitionTag],
            title: `生成角色视觉 · ${input.characterPath}`,
        });
        return {sessionId: created.sessionId};
    }

    /**
     * 读取可跨 Harness 重建的 durable result；journal 不自行推断 invocation 是否已 admission。
     *
     * 上游 admission 先写 lifecycle start，user entry 随后写入；因此按 clientMessageId 定位
     * user entry，再从它之前最近的 lifecycle start 取 invocationId，最后按该 invocation 的
     * 最新 lifecycle 判定 terminal 状态并读取 report_result。active 租约超时（进程崩溃残留）
     * 返回 orphaned，由 service 转为失败态，避免无限轮询。
     */
    async resolve(input: {sessionId: number; clientMessageId: string}): Promise<DurableResult> {
        const harness = useAgentHarness();
        const snapshot = await harness.repo.readSession(input.sessionId);
        const path = harness.repo.activePath(snapshot);
        const userIndex = path.findIndex((entry) => entry.type === "message"
            && entry.message.role === "user"
            && entry.clientMessageId === input.clientMessageId);
        if (userIndex < 0) {
            return {state: "missing"};
        }
        const startEntry = [...path.slice(0, userIndex + 1)].reverse().find(isLifecycleStartEntry);
        if (!startEntry) {
            return {state: "missing"};
        }
        const invocationId = startEntry.invocationId;
        const lifecycles = path.flatMap((entry, index) => entry.type === "invocation_lifecycle" && entry.invocationId === invocationId
            ? [{entry, index}]
            : []);
        const latest = lifecycles.at(-1);
        if (!latest || latest.entry.status === "start" || latest.entry.status === "resumed") {
            const leaseDeadline = (latest?.entry.timestamp ?? this.now()) + ACTIVE_EXECUTION_LEASE_MS;
            if (this.now() > leaseDeadline) {
                // 进程崩溃后无 lease renew：租约过期视为失去执行，避免 durable state 永久卡在 active。
                return {state: "orphaned", invocationId, lifecycle: "running", providerStartRecorded: null};
            }
            return {state: "active", invocationId, lifecycle: "running", executionLeaseUntil: new Date(leaseDeadline).toISOString()};
        }
        if (latest.entry.status === "waiting") {
            return {state: "waiting", invocationId};
        }
        if (latest.entry.status === "error" || latest.entry.status === "aborted" || latest.entry.status === "interrupted") {
            return {state: "failed", invocationId, errorInfo: latest.entry.errorInfo ?? null};
        }
        // status === "end"：terminal；找本 invocation 的 report_result toolResult。
        const reportResult = path.slice(userIndex, latest.index + 1).findLast((entry) => entry.type === "message"
            && entry.message.role === "toolResult"
            && entry.message.toolName === "report_result"
            && !entry.message.isError
            && isRecord(entry.message.details)
            && hasOwn(entry.message.details, "data"));
        if (reportResult?.type === "message"
            && reportResult.message.role === "toolResult"
            && isRecord(reportResult.message.details)
            && hasOwn(reportResult.message.details, "data")) {
            return {state: "completed", invocationId, reportResult: reportResult.message.details.data};
        }
        return {state: "completed_without_result", invocationId};
    }

    /**
     * 只等待 onAccepted 的 durable journal 回写，Provider 推理留在后台继续；这样 HTTP 可以按固定预算轮询 durable state。
     */
    async start(input: {
        sessionId: number;
        clientMessageId: string;
        projectPath: string;
        characterPath: string;
        characterMarkdown: string;
        sourceCharacterFileHash: string;
        onAccepted(input: {sessionId: number; invocationId: string; clientMessageId: string}): Promise<void>;
    }): Promise<void> {
        let settle: ((value: void) => void) | null = null;
        let reject: ((reason: Error) => void) | null = null;
        let accepted = false;
        const admitted = new Promise<void>((resolve, rejectPromise) => {
            settle = resolve;
            reject = rejectPromise;
        });
        void useAgentHarness().invokeAgent({
            sessionId: input.sessionId,
            mode: "prompt",
            clientMessageId: input.clientMessageId,
            message: {text: "根据当前角色事实生成严格角色视觉 JSON；只能调用 report_result，绝不写入 Project 文件。"},
            title: `生成角色视觉 · ${input.characterPath}`,
            caller: {kind: "system", profileKey: ILLUSTRATION_DIRECTOR_PROFILE_KEY},
            queueIfBusy: false,
            onAccepted: async (admission) => {
                await input.onAccepted(admission);
                accepted = true;
                settle?.();
            },
        }).catch((error: Error) => {
            if (!accepted) reject?.(error);
        });
        return admitted;
    }

    /** 调用 Task 3 的纯 materializer；它不拥有文件写入能力。 */
    async materialize(input: {
        runId: string;
        snapshot: CharacterVisualDirectWriteSnapshot;
        output: CharacterVisualDirectorOutput;
    }): Promise<CharacterVisualDirectWriteMaterialization> {
        const existingCharacter = parseExistingCharacter(input.snapshot.characterImageTags, input.snapshot.characterId);
        const existingOutfits = input.snapshot.referencedOutfits.flatMap((item) => {
            try {
                return [{path: item.path, outfit: parseOutfitTagsMarkdown(item.content).outfit}];
            } catch {
                return [];
            }
        });
        const materialized = await materializeCharacterVisualDirect({
            runId: input.runId,
            characterId: input.snapshot.characterId,
            existingCharacter,
            existingOutfits,
            output: input.output,
            resolveTag: async (tag) => this.resolver.resolveExplicitImportTag({
                runId: tag.runId,
                contextId: tag.contextId,
                resolutionId: tag.resolutionId,
                sourceText: tag.sourceText,
                modelScope: tag.modelScope,
                approval: tag.approval,
            }),
        });
        return {
            characterMarkdown: renderCharacterImageTagsMarkdown(materialized.character),
            outfits: materialized.outfits.map((item) => ({path: item.path, content: renderOutfitTagsMarkdown(item.outfit)})),
            diagnostics: materialized.diagnostics,
        };
    }

    /** Director model binding 属于 runtime config，Profile 绝不读取 Provider credential。 */
    async isDirectorConfigured(): Promise<boolean> {
        const effective = await loadEffectiveConfigForAgentRuntime({projectPath: this.projectPath});
        return Boolean(effective.agent.profiles[ILLUSTRATION_DIRECTOR_PROFILE_KEY]?.model.modelKey);
    }

    sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    now(): number {
        return Date.now();
    }

    invalidate(): void {
        invalidateProjectTreeIndex(this.projectPath);
    }

    private async root(): Promise<AbsoluteFsPath> {
        assertProjectOpen(textToImageProjectRef(this.projectPath));
        const root = await resolveWorkspaceRootInput({projectPath: this.projectPath});
        if (!root) throw new Error("Project Workspace root 缺失");
        return absoluteFsPath(root);
    }
}

function characterIdFromPath(characterPath: string): string {
    const match = /^lorebook\/character\/([^/\\]+)\/index\.md$/u.exec(characterPath);
    if (!match) throw new Error("角色路径不符合 direct-write contract");
    return match[1]!;
}

function parseExistingCharacter(content: string | null, characterId: string) {
    if (content === null) return null;
    try {
        const character = parseCharacterImageTagsMarkdown(content).character;
        return character.characterId === characterId ? character : null;
    } catch {
        return null;
    }
}

function isNotFoundError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** user entry 之前最近的一次 lifecycle start 才是本 invocation 的 durable admission。 */
function isLifecycleStartEntry(entry: SessionEntry): entry is InvocationLifecycleEntry {
    return entry.type === "invocation_lifecycle" && entry.status === "start";
}

/**
 * durable invocation 真相（与 service 侧 DurableResult 结构一致）。
 * active 租约用于崩溃残留检测：进程活着时 lifecycle 会持续推进，租约过期视为失去执行。
 */
type DurableResult =
    | {state: "missing"}
    | {state: "active"; invocationId: string; lifecycle: "accepted" | "running"; executionLeaseUntil: string}
    | {state: "orphaned"; invocationId: string; lifecycle: "accepted" | "running"; providerStartRecorded: boolean | null}
    | {state: "waiting"; invocationId: string}
    | {state: "failed"; invocationId: string; errorInfo: {message?: string} | null}
    | {state: "completed_without_result"; invocationId: string}
    | {state: "completed"; invocationId: string; reportResult: unknown};

/** 进程内无 lease renew 时，active 状态允许存活的上限；超过即视为失去执行租约。 */
const ACTIVE_EXECUTION_LEASE_MS = 3 * 60 * 1000;

/** "workspace/demo" → "demo"（上游 projectRoot 一律是单段 slug）。 */
function projectRootFromPath(projectPath: string): string {
    return projectPath.replace(/^workspace\//, "");
}

/** 稳定 key 排序后的 JSON 哈希；acquisition identity 比较用，避免对象 key 顺序干扰。 */
function stableJsonHash(value: JsonValue): string {
    return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function stableJsonStringify(value: JsonValue): string {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key] ?? null)}`).join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}
