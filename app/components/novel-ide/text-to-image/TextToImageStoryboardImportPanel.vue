<script setup lang="ts">
import {computed, ref, watch} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import {useAgentSessionApi} from "nbook/app/composables/useAgentSessionApi";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    StoryboardImportInspectPreview,
    StoryboardImportPreview,
    StoryboardImportResolutionGatePreview,
    StoryboardImportResolvedPreview,
    StoryboardImportSourceList,
} from "nbook/shared/text-to-image-storyboard-import";
import type {
    StoryboardGlobalPublishPreview,
    StoryboardGlobalPublishReceipt,
    StoryboardPublishTarget,
} from "nbook/shared/text-to-image-storyboard-publish";
import type {TagIndexStatus} from "nbook/shared/text-to-image-tag-index";

const props = defineProps<{
    projectPath: string;
    directorConfigured: boolean;
}>();

const emit = defineEmits<{
    (event: "open-director-settings"): void;
    (event: "global-published"): void;
}>();

const agentApi = useAgentSessionApi();
const notification = useNotification();
const sources = ref<StoryboardImportSourceList["sources"]>([]);
const selectedSource = ref("");
const inspected = ref<StoryboardImportInspectPreview | null>(null);
const preview = ref<StoryboardImportPreview | null>(null);
const tagIndexStatus = ref<TagIndexStatus | null>(null);
const sourceLoading = ref(false);
const inspecting = ref(false);
const converting = ref(false);
const resolving = ref(false);
const publishPreviewLoading = ref(false);
const publishing = ref(false);
const selectorRetrying = ref(false);
const publishTargetMode = ref<"candidate" | "save_as">("candidate");
const confirmReplaceActive = ref(false);
const saveAsPresetId = ref("");
const confirmGlobal = ref(false);
const publishPreview = ref<StoryboardGlobalPublishPreview | null>(null);
const publishReceipt = ref<StoryboardGlobalPublishReceipt | null>(null);
const reviewReason = ref("我已逐项检查该 Tag，并确认将其用于当前导入的 Pattern。");
const error = ref("");
const directorSessionId = ref<number | null>(null);
const pendingPreview = computed(() => preview.value?.state === "pending_unresolved" ? preview.value : null);
const gatePreview = computed<StoryboardImportResolutionGatePreview | null>(() => {
    const current = preview.value;
    return current?.state === "review_required" || current?.state === "blocked" ? current : null;
});
const resolvedPreview = computed<StoryboardImportResolvedPreview | null>(() => preview.value?.state === "pending" ? preview.value : null);
const tagIndexReady = computed(() => Boolean(tagIndexStatus.value?.active));

const publishTargetOptions: SelectOption[] = [
    {value: "candidate", label: "使用 candidate identity", description: "必要时显式替换当前同名 active preset", iconClass: "i-lucide-replace"},
    {value: "save_as", label: "另存为新 presetId", description: "重写 companion identity 后发布为新资源", iconClass: "i-lucide-copy-plus"},
];

const sourceOptions = computed<SelectOption[]>(() => sources.value.map((source) => ({
    value: source.relativePath,
    label: source.relativePath.slice("upload/".length),
    description: formatBytes(source.sizeBytes),
    iconClass: "i-lucide-file-json",
})));

const classificationRows = computed(() => {
    if (!inspected.value) return [];
    const labels = {
        core_rule: "核心分镜规则",
        atomic_group: "原子 Tag 组",
        scene_recipe: "场景组合",
        style_quality: "画风/质量提议",
        negative_constraint: "负向约束",
        trigger_alias: "触发别名",
        macro: "宏",
    } as const;
    return Object.entries(inspected.value.classificationCounts)
        .map(([key, count]) => ({key, label: labels[key as keyof typeof labels], count}))
        .filter((item) => item.count > 0);
});

watch(() => props.projectPath, () => {
    sources.value = [];
    selectedSource.value = "";
    inspected.value = null;
    preview.value = null;
    directorSessionId.value = null;
    error.value = "";
    resetPublishState(true);
    if (props.projectPath) {
        void loadSources();
        void loadTagIndexStatus();
    }
}, {immediate: true});

watch([publishTargetMode, confirmReplaceActive, saveAsPresetId], () => {
    resetPublishState(false);
});

watch(() => resolvedPreview.value?.package.previewToken ?? null, () => {
    resetPublishState(false);
});

/** 清空客户端短生命周期发布确认；Global Config 与 journal 从不保存在浏览器。 */
function resetPublishState(resetTarget: boolean): void {
    publishPreview.value = null;
    publishReceipt.value = null;
    confirmGlobal.value = false;
    if (resetTarget) {
        publishTargetMode.value = "candidate";
        confirmReplaceActive.value = false;
        saveAsPresetId.value = "";
    }
}

/** 读取本地 active index 状态；该端点不会触发 official 网络请求。 */
async function loadTagIndexStatus(): Promise<void> {
    try {
        tagIndexStatus.value = await $fetch<TagIndexStatus>("/api/text-to-image/tag-index");
    } catch {
        tagIndexStatus.value = null;
    }
}

/** 只读取当前 Project upload 顶层 JSON 文件名和大小。 */
async function loadSources(): Promise<void> {
    if (!props.projectPath || sourceLoading.value) return;
    sourceLoading.value = true;
    error.value = "";
    try {
        const result = await $fetch<StoryboardImportSourceList>("/api/text-to-image/storyboard-imports/sources", {
            query: {projectPath: props.projectPath},
        });
        sources.value = result.sources;
        if (!result.sources.some((source) => source.relativePath === selectedSource.value)) {
            selectedSource.value = result.sources[0]?.relativePath ?? "";
            inspected.value = null;
            preview.value = null;
        }
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "读取 upload JSON 列表失败");
    } finally {
        sourceLoading.value = false;
    }
}

/** 切换来源时清空页面预览；持久化真相仍只在服务端 archive/journal。 */
function selectSource(relativePath: string): void {
    selectedSource.value = relativePath;
    inspected.value = null;
    preview.value = null;
    directorSessionId.value = null;
    error.value = "";
    resetPublishState(true);
}

/** 执行 strict inspect；响应只含统计、宏和 secret 路径。 */
async function inspectSource(): Promise<void> {
    if (!props.projectPath || !selectedSource.value || inspecting.value) return;
    inspecting.value = true;
    error.value = "";
    preview.value = null;
    try {
        inspected.value = await $fetch<StoryboardImportInspectPreview>("/api/text-to-image/storyboard-imports/inspect", {
            method: "POST",
            body: {projectPath: props.projectPath, sourceRelativePath: selectedSource.value},
        });
    } catch (caught) {
        inspected.value = null;
        error.value = resolveApiErrorMessage(caught, "检查 TTP Storyboard JSON 失败");
    } finally {
        inspecting.value = false;
    }
}

/** 创建一次受限 illustration.director session，转换完成后从 journal 读取只读预览。 */
async function convertInspectedSource(): Promise<void> {
    if (!inspected.value || converting.value) return;
    if (!props.directorConfigured) {
        emit("open-director-settings");
        return;
    }
    converting.value = true;
    error.value = "";
    preview.value = null;
    try {
        const created = await agentApi.createSession({
            profileKey: "illustration.director",
            initial: {operation: "convert-preset", sourceRelativePath: inspected.value.sourceRelativePath},
            currentProjectRoot: props.projectPath.replace(/^workspace\//, ""),
        });
        directorSessionId.value = created.sessionId;
        await agentApi.invokeSession(created.sessionId, {
            mode: "prompt",
            message: {text: "执行当前已检查来源的 convert-preset 工作流，并提交完整 strict conversion。"},
            title: `转换 ${inspected.value.sourceRelativePath}`,
            block: true,
        });
        preview.value = await $fetch<StoryboardImportPreview>("/api/text-to-image/storyboard-imports/preview", {
            query: {importId: inspected.value.importId},
        });
        await loadTagIndexStatus();
        notification.success("Storyboard 与 Tag Pattern pending 候选已生成");
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "插图 Director 转换失败");
    } finally {
        converting.value = false;
    }
}

/** 用 active index 解析全部 pending atom；review gate 只能逐项同时确认当前 request hash。 */
async function resolvePendingTags(withApprovals: boolean): Promise<void> {
    const current = preview.value;
    if (!current || resolving.value || !inspected.value) return;
    if (current.state === "blocked" || current.state === "pending") return;
    const expectedPreviewToken = current.previewToken;
    if (withApprovals && !reviewReason.value.trim()) {
        error.value = "逐项批准必须填写审查理由";
        return;
    }
    const approvals = withApprovals && current.state === "review_required"
        ? current.entries.flatMap((entry) => entry.outcome === "review_required" ? [{
            reviewRequestHash: entry.review.reviewRequestHash,
            reason: reviewReason.value.trim(),
        }] : [])
        : [];
    resolving.value = true;
    error.value = "";
    try {
        preview.value = await $fetch<StoryboardImportPreview>("/api/text-to-image/storyboard-imports/resolve", {
            method: "POST",
            body: {
                projectPath: props.projectPath,
                importId: inspected.value.importId,
                expectedPreviewToken,
                approvals,
            },
        });
        notification.success(preview.value.state === "pending" ? "Tag resolution 已冻结为正式候选" : "Tag resolution 审查门已生成");
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "解析 Storyboard Tag 失败");
    } finally {
        resolving.value = false;
    }
}

/** 将 terminal kind 投影为用户可读结果。 */
/** 构建唯一允许提交的逻辑目标；目标文件路径始终由服务端 companion identity 派生。 */
function currentPublishTarget(): StoryboardPublishTarget | null {
    if (publishTargetMode.value === "candidate") {
        return {mode: "candidate", confirmReplaceActive: confirmReplaceActive.value};
    }
    const presetId = saveAsPresetId.value.trim();
    if (!presetId) return null;
    return {mode: "save_as", presetId};
}

/** 复验 resolved 来源、active companion 与完整 Global Config hash，返回无副作用预览。 */
async function loadPublishPreview(): Promise<void> {
    const resolved = resolvedPreview.value;
    const target = currentPublishTarget();
    if (!resolved || publishPreviewLoading.value) return;
    if (!target) {
        error.value = "另存为发布必须填写新的 presetId";
        return;
    }
    publishPreviewLoading.value = true;
    publishReceipt.value = null;
    confirmGlobal.value = false;
    error.value = "";
    try {
        publishPreview.value = await $fetch<StoryboardGlobalPublishPreview>(
            "/api/text-to-image/storyboard-imports/publish-preview",
            {
                method: "POST",
                body: {
                    projectPath: props.projectPath,
                    importId: resolved.package.importId,
                    expectedResolvedPreviewToken: resolved.package.previewToken,
                    target,
                },
            },
        );
    } catch (caught) {
        publishPreview.value = null;
        error.value = resolveApiErrorMessage(caught, "读取全局发布预览失败");
    } finally {
        publishPreviewLoading.value = false;
    }
}

/** 只提交预览冻结的 hashes 与全局确认，不允许客户端提交 companion bytes 或目标路径。 */
async function publishGlobalPair(): Promise<void> {
    const resolved = resolvedPreview.value;
    const current = publishPreview.value;
    if (!resolved || !current || current.state !== "ready" || publishing.value) return;
    if (!confirmGlobal.value) {
        error.value = "必须确认本次操作会修改所有 Project 共用的全局 Storyboard selector";
        return;
    }
    publishing.value = true;
    error.value = "";
    try {
        publishReceipt.value = await $fetch<StoryboardGlobalPublishReceipt>(
            "/api/text-to-image/storyboard-imports/publish",
            {
                method: "POST",
                body: {
                    projectPath: props.projectPath,
                    importId: current.importId,
                    expectedResolvedPreviewToken: resolved.package.previewToken,
                    publishPreviewToken: current.publishPreviewToken,
                    target: current.target,
                    candidatePackageHash: current.sourceCandidatePackageHash,
                    diagnosticHash: current.diagnosticHash,
                    expectedActivePresetFileHash: current.expected.activePresetFileHash,
                    expectedActivePatternFileHash: current.expected.activePatternFileHash,
                    expectedGlobalConfigHash: current.expected.globalConfigHash,
                    targetScope: "global",
                    confirmGlobal: true,
                },
            },
        );
        if (publishReceipt.value.state === "completed") {
            notification.success("Storyboard / Tag Pattern 全局 companion 已发布并设为 active");
            emit("global-published");
        } else {
            notification.warning("两份 companion 已发布，但 Global Config 已变化，selector 尚未切换");
        }
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "发布全局 Storyboard companion 失败");
    } finally {
        publishing.value = false;
    }
}

/** published_not_selected 只使用服务端回传的新 config hash 重试 selector，不重写工件。 */
async function retryGlobalSelector(): Promise<void> {
    const current = publishPreview.value;
    const receipt = publishReceipt.value;
    if (!current || !receipt?.retryExpectedGlobalConfigHash || selectorRetrying.value) return;
    selectorRetrying.value = true;
    error.value = "";
    try {
        publishReceipt.value = await $fetch<StoryboardGlobalPublishReceipt>(
            "/api/text-to-image/storyboard-imports/publish-selector-retry",
            {
                method: "POST",
                body: {
                    projectPath: props.projectPath,
                    importId: receipt.importId,
                    publishId: receipt.publishId,
                    expectedActivePresetFileHash: current.expected.activePresetFileHash,
                    expectedActivePatternFileHash: current.expected.activePatternFileHash,
                    expectedGlobalConfigHash: receipt.retryExpectedGlobalConfigHash,
                    targetScope: "global",
                    confirmGlobal: true,
                },
            },
        );
        if (publishReceipt.value.state === "completed") {
            notification.success("全局 Storyboard selector 已切换到新 companion");
            emit("global-published");
        } else {
            notification.warning("Global Config 再次变化，请核对后重试 selector");
        }
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "重试全局 Storyboard selector 失败");
    } finally {
        selectorRetrying.value = false;
    }
}

function terminalLabel(entry: StoryboardImportResolvedPreview["diff"]["entries"][number]): string {
    if (entry.terminal.kind === "canonical") return `canonical → ${entry.terminal.canonical.canonicalName}`;
    if (entry.terminal.kind === "replacement") return `replacement → ${entry.terminal.canonical.canonicalName}`;
    return `NovelAI 透传 → ${entry.terminal.wireText}`;
}

/** 以短 hash 展示身份；完整值仍保留在 DTO 与可展开 Markdown。 */
function shortHash(value: string): string {
    return value.length <= 24 ? value : `${value.slice(0, 17)}…${value.slice(-6)}`;
}

/** 用一致的人类可读单位展示 source 文件大小。 */
function formatBytes(value: number): string {
    if (value < 1024) return `${String(value)} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
</script>

<template>
    <!-- TTP Storyboard：Project upload 显式选择，服务端 inspect/Agent convert/只读 preview -->
    <section class="mb-4 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45">
        <div class="flex min-h-9 items-center justify-between gap-2 border-b border-[var(--border-color)] px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
                <span class="i-lucide-file-json h-4 w-4 shrink-0 text-[var(--accent-main)]"></span>
                <div class="min-w-0">
                    <h3 class="truncate text-[12px] font-medium text-[var(--text-main)]">TTP Storyboard 导入</h3>
                    <p class="m-0 mt-0.5 text-[10px] text-[var(--text-muted)]">只检查 Project upload 顶层 JSON；不会上传即激活。</p>
                </div>
            </div>
            <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium" :class="resolvedPreview ? 'border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'">{{ resolvedPreview ? "resolved candidate" : "pending review" }}</span>
        </div>

        <div class="space-y-3 px-3 py-3">
            <!-- 来源选择 -->
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                <FormSelect :model-value="selectedSource" label="Project upload JSON" :options="sourceOptions" :disabled="sourceLoading || converting || !projectPath" placeholder="没有可用的 upload/*.json" @update:model-value="selectSource" />
                <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="sourceLoading || converting || !projectPath" @click="void loadSources()">
                    <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{'animate-spin': sourceLoading}"></span>
                    刷新
                </button>
                <button type="button" class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="!selectedSource || inspecting || converting" @click="void inspectSource()">
                    <span class="i-lucide-scan-search h-3.5 w-3.5"></span>
                    {{ inspecting ? "检查中" : "检查来源" }}
                </button>
            </div>

            <p v-if="!sourceLoading && sources.length === 0" class="m-0 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 py-2 text-[11px] text-[var(--status-info)]">请先把 TTP JSON 放入当前 Project Workspace 的 <code>upload/</code> 顶层。</p>
            <p v-if="error" class="m-0 rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ error }}</p>

            <!-- Inspect 摘要 -->
            <div v-if="inspected" class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-medium text-[var(--text-main)]">{{ inspected.sourcePresetKey }}</div>
                        <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">{{ inspected.entryCount }} entries · {{ inspected.enabledCounts.enabled }} enabled · {{ inspected.enabledCounts.disabled }} disabled · {{ inspected.chunkCount }} chunks</div>
                    </div>
                    <code class="text-[10px] text-[var(--text-muted)]">{{ shortHash(inspected.importId) }}</code>
                </div>

                <div class="flex flex-wrap gap-1.5">
                    <span v-for="item in classificationRows" :key="item.key" class="rounded-full border border-[var(--border-color)] bg-[var(--bg-input)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{{ item.label }} {{ item.count }}</span>
                </div>

                <div v-if="inspected.macroTokens.length > 0" class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[10px] text-[var(--status-warning)]">
                    检出 {{ inspected.macroTokens.length }} 个宏，其中 {{ inspected.macroTokens.filter((token) => token.blocking).length }} 个阻断；详情会进入 import report。
                    <ul class="mb-0 mt-1 space-y-0.5 pl-4">
                        <li v-for="token in inspected.macroTokens.slice(0, 20)" :key="`${token.path}:${token.token}`"><code>{{ token.token }}</code> · {{ token.classification }}<span v-if="token.blocking"> · blocking</span></li>
                    </ul>
                    <div v-if="inspected.macroTokens.length > 20" class="mt-1">另有 {{ inspected.macroTokens.length - 20 }} 个宏，完整清单见 report。</div>
                </div>
                <div v-if="inspected.secretPaths.length > 0" class="text-[10px] text-[var(--text-muted)]">已在持久化前脱敏 {{ inspected.secretPaths.length }} 个字段：{{ inspected.secretPaths.join("、") }}</div>
                <div class="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[11px] text-[var(--status-warning)]">
                    <strong>{{ inspected.tagResolution.code }}</strong>：{{ inspected.tagResolution.message }}
                </div>

                <div class="flex flex-wrap items-center justify-end gap-2">
                    <button v-if="!directorConfigured" type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('open-director-settings')">
                        <span class="i-lucide-settings-2 h-3.5 w-3.5"></span>
                        配置 Director 模型
                    </button>
                    <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:cursor-not-allowed disabled:opacity-50" :disabled="converting || !directorConfigured" @click="void convertInspectedSource()">
                        <span class="i-lucide-clapperboard h-3.5 w-3.5"></span>
                        {{ converting ? "Director 转换中" : "生成 pending 候选" }}
                    </button>
                </div>
                <div v-if="directorSessionId !== null" class="text-right text-[10px] text-[var(--text-muted)]">Agent Session #{{ directorSessionId }}</div>
            </div>

            <!-- Pending companion 预览 -->
            <div v-if="pendingPreview" class="space-y-3 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold text-[var(--text-main)]">pending_unresolved companion package</div>
                        <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">{{ pendingPreview.package.storyboard.ruleCount }} rules · {{ pendingPreview.package.patterns.patternCount }} patterns · {{ pendingPreview.package.recipeProposals.length }} Recipe proposals</div>
                    </div>
                    <code class="text-[10px] text-[var(--text-muted)]">{{ shortHash(pendingPreview.package.candidatePackageHash) }}</code>
                </div>

                <div class="grid gap-2 sm:grid-cols-2">
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                        <div class="text-[10px] text-[var(--text-muted)]">Storyboard semanticHash</div>
                        <code class="text-[10px] text-[var(--text-secondary)]">{{ shortHash(pendingPreview.package.storyboard.semanticHash) }}</code>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                        <div class="text-[10px] text-[var(--text-muted)]">Pattern planning / render</div>
                        <code class="block text-[10px] text-[var(--text-secondary)]">{{ shortHash(pendingPreview.package.patterns.planningHash) }}</code>
                        <code class="block text-[10px] text-[var(--text-secondary)]">{{ shortHash(pendingPreview.package.patterns.renderHash) }}</code>
                    </div>
                </div>

                <div v-if="pendingPreview.package.recipeProposals.length > 0" class="space-y-2">
                    <div class="text-[11px] font-medium text-[var(--text-main)]">Recipe 只读提议</div>
                    <div v-for="proposal in pendingPreview.package.recipeProposals" :key="proposal.proposalId" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-[10px] text-[var(--text-secondary)]">
                        <div class="font-medium text-[var(--text-main)]">{{ proposal.summary }}</div>
                        <div class="mt-1">正向：{{ proposal.positiveAtoms.join(", ") || "无" }}</div>
                        <div>负向：{{ proposal.negativeAtoms.join(", ") || "无" }}</div>
                        <div v-if="proposal.ignoredProviderParameters.length > 0" class="mt-1 text-[var(--status-warning)]">已忽略 Provider 参数：{{ proposal.ignoredProviderParameters.join(", ") }}</div>
                    </div>
                </div>

                <details class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                    <summary class="cursor-pointer text-[11px] font-medium text-[var(--text-main)]">Storyboard candidate Markdown</summary>
                    <pre class="custom-scrollbar mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--text-secondary)]">{{ pendingPreview.storyboardMarkdown }}</pre>
                </details>
                <details class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                    <summary class="cursor-pointer text-[11px] font-medium text-[var(--text-main)]">Tag Pattern candidate Markdown</summary>
                    <pre class="custom-scrollbar mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--text-secondary)]">{{ pendingPreview.patternMarkdown }}</pre>
                </details>

                <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-3 py-2">
                    <span class="text-[10px]" :class="tagIndexReady ? 'text-[var(--status-info)]' : 'text-[var(--status-warning)]'"><strong>{{ tagIndexReady ? "READY_TO_RESOLVE" : pendingPreview.approval.code }}</strong>：{{ tagIndexReady ? `active ${tagIndexStatus?.active?.indexVersion} 已就绪，可生成确定性 diff。` : pendingPreview.approval.message }}</span>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] font-medium text-[var(--text-secondary)]" :disabled="resolving" @click="void loadTagIndexStatus()">
                            <span class="i-lucide-refresh-cw h-3.5 w-3.5"></span>
                            刷新索引状态
                        </button>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="!tagIndexReady || resolving" @click="void resolvePendingTags(false)">
                            <span class="i-lucide-git-compare-arrows h-3.5 w-3.5"></span>
                            {{ resolving ? "解析中" : "解析 Tag 并生成 diff" }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- policy review / block gate -->
            <div v-if="gatePreview" class="space-y-3 rounded-md border px-3 py-3" :class="gatePreview.state === 'blocked' ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)]'">
                <div>
                    <div class="text-[11px] font-semibold text-[var(--text-main)]">{{ gatePreview.state === "blocked" ? "Tag policy 阻断" : "逐项人工复核" }}</div>
                    <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">{{ gatePreview.entries.length }} 项 · token {{ shortHash(gatePreview.previewToken) }}</div>
                </div>
                <div class="custom-scrollbar max-h-72 space-y-1 overflow-auto">
                    <div v-for="entry in gatePreview.entries" :key="entry.resolutionId" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[10px] text-[var(--text-secondary)]">
                        <div class="flex flex-wrap justify-between gap-2"><code class="text-[var(--text-main)]">{{ entry.atom.sourceText }}</code><span :class="entry.outcome === 'blocked' ? 'text-[var(--status-danger)]' : 'text-[var(--status-warning)]'">{{ entry.outcome }}</span></div>
                        <div class="mt-1 text-[var(--text-muted)]">{{ entry.patternId }} · {{ entry.atom.ownerSlot.field }}</div>
                        <div v-if="entry.outcome === 'review_required'" class="mt-1">policy {{ entry.review.policy.policyVersion }} · {{ entry.review.policy.matchedRuleIds.join(", ") || "unknown policy" }}</div>
                        <div v-else class="mt-1">{{ entry.code }}</div>
                    </div>
                </div>
                <template v-if="gatePreview.state === 'review_required'">
                    <FormInput v-model="reviewReason" label="逐项批准理由" placeholder="说明为何确认这些 Tag" />
                    <div class="flex justify-end">
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="resolving || !reviewReason.trim()" @click="void resolvePendingTags(true)"><span class="i-lucide-shield-check h-3.5 w-3.5"></span>{{ resolving ? "复验中" : "逐项批准并重新解析" }}</button>
                    </div>
                </template>
                <p v-else class="m-0 text-[11px] text-[var(--status-danger)]">block / deprecated 不能由 approval 绕过；请修改来源候选后重新转换。</p>
            </div>

            <!-- resolved terminal diff 与管理员全局 companion 发布 -->
            <div v-if="resolvedPreview" class="space-y-3 rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-semibold text-[var(--text-main)]">Resolved Storyboard / Tag Pattern candidate</div>
                        <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">{{ resolvedPreview.package.storyboard.ruleCount }} rules · {{ resolvedPreview.package.patterns.patternCount }} patterns · {{ resolvedPreview.package.patterns.resolutionCount }} terminal resolutions</div>
                    </div>
                    <code class="text-[10px] text-[var(--text-muted)]">{{ shortHash(resolvedPreview.package.candidatePackageHash) }}</code>
                </div>
                <div class="grid gap-2 text-[10px] text-[var(--text-secondary)] sm:grid-cols-4">
                    <div>canonical {{ resolvedPreview.diff.counts.canonical }}</div>
                    <div>replacement {{ resolvedPreview.diff.counts.replacement }}</div>
                    <div>passthrough {{ resolvedPreview.diff.counts.providerPassthrough }}</div>
                    <div>approval {{ resolvedPreview.diff.counts.policyApprovals }}</div>
                </div>
                <div class="custom-scrollbar max-h-80 space-y-1 overflow-auto">
                    <div v-for="entry in resolvedPreview.diff.entries" :key="entry.resolutionKey" class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 py-2 text-[10px] text-[var(--text-secondary)]">
                        <div class="flex flex-wrap justify-between gap-2"><code class="text-[var(--text-main)]">{{ entry.sourceText }}</code><span class="text-[var(--status-success)]">{{ terminalLabel(entry) }}</span></div>
                        <div class="mt-1 text-[var(--text-muted)]">{{ entry.patternId }} · {{ entry.ownerSlot.field }}<span v-if="entry.policyApproval"> · 已记录 policy approval</span></div>
                    </div>
                </div>
                <details class="rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2"><summary class="cursor-pointer text-[11px] font-medium text-[var(--text-main)]">Resolved Tag Pattern Markdown</summary><pre class="custom-scrollbar mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-[var(--text-secondary)]">{{ resolvedPreview.patternMarkdown }}</pre></details>
                <!-- 全局发布确认区：只提交选择、token 与 expected hashes -->
                <div class="space-y-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-3">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div>
                            <div class="text-[11px] font-semibold text-[var(--text-main)]">全局批准发布</div>
                            <div class="mt-0.5 text-[10px] text-[var(--text-muted)]">管理员操作；同时发布 approved Storyboard / Tag Pattern companion，并在最后切换 Director selector。</div>
                        </div>
                        <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="publishPreviewLoading || publishing || selectorRetrying" @click="void loadPublishPreview()"><span class="i-lucide-scan-search h-3.5 w-3.5" :class="{'animate-spin': publishPreviewLoading}"></span>{{ publishPreviewLoading ? "复验中" : "生成发布预览" }}</button>
                    </div>
                    <FormSelect v-model="publishTargetMode" label="发布 identity" :options="publishTargetOptions" :disabled="publishPreviewLoading || publishing || selectorRetrying" />
                    <FormInput v-if="publishTargetMode === 'save_as'" v-model="saveAsPresetId" label="新 presetId" placeholder="例如 cinematic.storyboard.v2" />
                    <label v-else class="flex items-start gap-2 text-[10px] text-[var(--text-secondary)]"><input v-model="confirmReplaceActive" type="checkbox" class="mt-0.5 accent-[var(--accent-main)]" /><span>若 candidate presetId 与当前 active identity 相同，明确允许以新 immutable companion 替换并切换 selector。</span></label>

                    <div v-if="publishPreview" class="space-y-2">
                        <div class="grid gap-2 text-[10px] text-[var(--text-secondary)] sm:grid-cols-2">
                            <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2"><div class="text-[var(--text-muted)]">当前 selector</div><code class="break-all text-[var(--text-main)]">{{ publishPreview.previousSelectorKey }}</code><div class="mt-1">active preset: {{ publishPreview.active?.presetId ?? "无已发布 companion" }}</div></div>
                            <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2"><div class="text-[var(--text-muted)]">目标 companion</div><code class="break-all text-[var(--text-main)]">{{ publishPreview.published.presetPath }}</code><div class="mt-1"><code class="break-all">{{ publishPreview.published.patternPath }}</code></div></div>
                        </div>
                        <div class="grid gap-1 text-[10px] text-[var(--text-muted)] sm:grid-cols-3"><div>preset {{ publishPreview.expected.activePresetFileHash ? shortHash(publishPreview.expected.activePresetFileHash) : "∅" }}</div><div>patterns {{ publishPreview.expected.activePatternFileHash ? shortHash(publishPreview.expected.activePatternFileHash) : "∅" }}</div><div>config {{ shortHash(publishPreview.expected.globalConfigHash) }}</div></div>
                        <div v-if="publishPreview.state === 'conflict'" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[10px] text-[var(--status-danger)]">{{ publishPreview.conflict?.message }} 请勾选显式替换，或选择“另存为”后重新生成预览。</div>
                        <template v-else>
                            <label class="flex items-start gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[10px] text-[var(--status-warning)]"><input v-model="confirmGlobal" type="checkbox" class="mt-0.5 accent-[var(--accent-main)]" /><span>我确认这是全局修改：新 selector 会影响所有使用 illustration.director 默认 Storyboard 的 Project。</span></label>
                            <div class="flex justify-end"><button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="!confirmGlobal || publishing || selectorRetrying" @click="void publishGlobalPair()"><span class="i-lucide-shield-check h-3.5 w-3.5"></span>{{ publishing ? "发布中" : "发布 companion 并切换 selector" }}</button></div>
                        </template>
                    </div>

                    <div v-if="publishReceipt?.state === 'published_not_selected'" class="space-y-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] px-3 py-2 text-[10px] text-[var(--status-warning)]"><div>两份 approved immutable files 已发布，但 Global Config 在发布期间变化；selector 保持 {{ publishReceipt.currentSelectorKey }}。</div><div class="flex justify-end"><button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--status-warning-border)] bg-[var(--bg-panel)] px-3 text-[11px] disabled:opacity-50" :disabled="selectorRetrying || publishing" @click="void retryGlobalSelector()"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{'animate-spin': selectorRetrying}"></span>{{ selectorRetrying ? "重试中" : "确认当前配置并只重试 selector" }}</button></div></div>
                    <div v-else-if="publishReceipt?.state === 'completed'" class="rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-[10px] text-[var(--status-success)]">发布完成；当前全局 selector 为 <code class="break-all">{{ publishReceipt.currentSelectorKey }}</code>。</div>
                </div>
            </div>
        </div>
    </section>
</template>
