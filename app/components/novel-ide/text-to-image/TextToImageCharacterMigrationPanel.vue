<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {
    CharacterVisualMigrationScan,
    CharacterVisualMigrationSnapshot,
} from "nbook/shared/text-to-image-character-migration";

const props = defineProps<{projectPath: string}>();
const notification = useNotification();
const scan = ref<CharacterVisualMigrationScan | null>(null);
const snapshot = ref<CharacterVisualMigrationSnapshot | null>(null);
const acceptedKeys = ref<string[]>([]);
const approvedReviewHashes = ref<string[]>([]);
const reviewReason = ref("我已逐项检查该角色视觉 Tag，并确认用于当前 Project。");
const loading = ref(false);
const action = ref<"prepare" | "resolve" | "apply" | "resume" | null>(null);
const error = ref("");

const legacyItems = computed(() => scan.value?.items.filter((item) => item.status !== "v2") ?? []);
const migratedCount = computed(() => scan.value?.items.filter((item) => item.status === "v2").length ?? 0);
const pendingMigrations = computed(() => scan.value?.pendingMigrations ?? []);
const resolutions = computed(() => new Map(snapshot.value?.resolutions.map((item) => [item.resolutionKey, item]) ?? []));
const reviews = computed(() => new Map(snapshot.value?.reviews.map((item) => [item.resolutionKey, item]) ?? []));
const blocked = computed(() => new Map(snapshot.value?.blocked.map((item) => [item.resolutionKey, item]) ?? []));
const allTerminalAccepted = computed(() => {
    const current = snapshot.value;
    return current?.stage === "ready"
        && current.resolutions.length === current.candidate.pendingAtoms.length
        && acceptedKeys.value.length === current.resolutions.length;
});
const allReviewsApproved = computed(() => {
    const current = snapshot.value;
    return current?.stage === "review_required"
        && current.reviews.length > 0
        && approvedReviewHashes.value.length === current.reviews.length
        && reviewReason.value.trim().length > 0;
});

watch(() => props.projectPath, () => {
    scan.value = null;
    snapshot.value = null;
    acceptedKeys.value = [];
    approvedReviewHashes.value = [];
    error.value = "";
    if (props.projectPath) void scanProject();
}, {immediate: true});

/** 只读扫描 Project 角色视觉文件，不创建 migration。 */
async function scanProject(): Promise<void> {
    if (!props.projectPath || loading.value || action.value !== null) return;
    loading.value = true;
    error.value = "";
    try {
        scan.value = await $fetch<CharacterVisualMigrationScan>("/api/text-to-image/character-visual-migrations/scan", {
            query: {projectPath: props.projectPath},
        });
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "扫描角色视觉文件失败");
    } finally {
        loading.value = false;
    }
}

/** 为选中的 legacy 角色创建或恢复稳定 proposal/report。 */
async function prepare(characterPath: string): Promise<void> {
    if (action.value !== null) return;
    action.value = "prepare";
    error.value = "";
    try {
        setSnapshot(await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/prepare", {
            method: "POST",
            body: {projectPath: props.projectPath, characterPath},
        }));
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "创建角色视觉迁移 proposal 失败");
    } finally {
        action.value = null;
    }
}

/** 读取由角色详情、外部源或 legacy 扫描创建的持久 migration。 */
async function loadMigration(migrationId: string): Promise<void> {
    if (action.value !== null) return;
    action.value = "prepare";
    error.value = "";
    try {
        setSnapshot(await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/snapshot", {
            query: {projectPath: props.projectPath, migrationId},
        }));
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "读取角色视觉 migration 失败");
    } finally {
        action.value = null;
    }
}

/** 解析全部 pending atoms；review approval 只绑定当前服务端 review hash。 */
async function resolveAtoms(): Promise<void> {
    const current = snapshot.value;
    if (!current || action.value !== null) return;
    action.value = "resolve";
    error.value = "";
    try {
        const approvalHashes = new Set(approvedReviewHashes.value);
        setSnapshot(await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/resolve", {
            method: "POST",
            body: {
                projectPath: props.projectPath,
                migrationId: current.candidate.migrationId,
                expectedPreviewToken: current.previewToken,
                approvals: current.reviews
                    .filter((item) => approvalHashes.has(item.review.reviewRequestHash))
                    .map((item) => ({reviewRequestHash: item.review.reviewRequestHash, reason: reviewReason.value.trim()})),
            },
        }));
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "解析角色视觉 Tag 失败；请先确认 active Danbooru 3K+ 索引可用");
    } finally {
        action.value = null;
    }
}

/** 逐项确认全部 terminal diff 后启动 tracked-write journal。 */
async function applyMigration(): Promise<void> {
    const current = snapshot.value;
    if (!current || !allTerminalAccepted.value || action.value !== null) return;
    action.value = "apply";
    error.value = "";
    try {
        setSnapshot(await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/apply", {
            method: "POST",
            body: {
                projectPath: props.projectPath,
                migrationId: current.candidate.migrationId,
                expectedPreviewToken: current.previewToken,
                acceptedResolutionKeys: acceptedKeys.value,
            },
        }));
        notification.success("角色与服装已升级为严格 V2 Tag snapshots");
        action.value = null;
        await scanProject();
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "应用角色视觉迁移失败");
    } finally {
        action.value = null;
    }
}

/** 从持久 journal 恢复中断 apply，不重新解析或改用新配置。 */
async function resumeMigration(): Promise<void> {
    const current = snapshot.value;
    if (!current || action.value !== null) return;
    action.value = "resume";
    error.value = "";
    try {
        setSnapshot(await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/resume", {
            method: "POST",
            body: {projectPath: props.projectPath, migrationId: current.candidate.migrationId},
        }));
        notification.success("角色视觉迁移 journal 已恢复完成");
        action.value = null;
        await scanProject();
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "恢复角色视觉迁移失败");
    } finally {
        action.value = null;
    }
}

/** 切换快照时清空所有客户端短生命周期确认。 */
function setSnapshot(value: CharacterVisualMigrationSnapshot): void {
    snapshot.value = value;
    acceptedKeys.value = [];
    approvedReviewHashes.value = [];
}

/** 展示 terminal resolution 的 canonical/replacement/passthrough 结果。 */
function resolutionSummary(resolutionKey: string): string {
    const terminal = resolutions.value.get(resolutionKey)?.terminal;
    if (!terminal) return reviews.value.has(resolutionKey) ? "需要逐项审核" : blocked.value.get(resolutionKey)?.code ?? "待解析";
    if (terminal.kind === "provider_passthrough") return `透传：${terminal.wireText}`;
    return `${terminal.kind === "replacement" ? "替换" : terminal.matchedBy === "alias" ? "别名归一" : "精确"}：${terminal.canonical.canonicalName}`;
}

/** 使用已有状态主题变量映射迁移阶段。 */
function stageClass(stage: string): string {
    if (stage === "ready" || stage === "applied") return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    if (stage === "blocked") return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]";
    if (stage === "applying") return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]";
    return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
}
</script>

<template>
    <section class="overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] shadow-sm">
        <!-- Character V2 migration 标题与扫描入口 -->
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3">
            <div>
                <h3 class="m-0 text-sm font-semibold text-[var(--text-main)]">角色 / 服装 Tag V2 迁移</h3>
                <p class="m-0 mt-1 text-[11px] text-[var(--text-muted)]">旧自由字符串只作为 proposal source；解析、逐项确认和 journal 完成前不会进入新 Compiler。</p>
            </div>
            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="loading || action !== null || !projectPath" @click="void scanProject()"><span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="{'animate-spin': loading}"></span>重新扫描</button>
        </div>

        <div class="space-y-3 px-4 py-3">
            <div v-if="error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[11px] text-[var(--status-danger)]">{{ error }}</div>
            <div v-if="scan" class="text-[10px] text-[var(--text-muted)]">已升级 {{ migratedCount }} 个角色；待处理 {{ legacyItems.length }} 个角色。</div>

            <!-- 所有来源共享的持久 migration 恢复入口 -->
            <div v-if="pendingMigrations.length > 0" class="space-y-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-bg)] p-3">
                <div class="text-[10px] font-semibold text-[var(--status-info)]">待继续的 migration</div>
                <div v-for="item in pendingMigrations" :key="item.migrationId" class="flex items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2"><div class="min-w-0"><code class="block truncate text-[9px] text-[var(--text-main)]">{{ item.migrationId }}</code><div class="mt-1 text-[9px] text-[var(--text-muted)]">{{ item.sourceKind }} · {{ item.stage }} · {{ item.characterPath }}</div></div><button type="button" class="h-7 shrink-0 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-2.5 text-[10px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="action !== null" @click="void loadMigration(item.migrationId)">继续审核</button></div>
            </div>

            <!-- 扫描结果只提供 proposal 创建入口 -->
            <div v-if="legacyItems.length > 0" class="grid gap-2 lg:grid-cols-2">
                <div v-for="item in legacyItems" :key="item.characterPath" class="flex items-center justify-between gap-3 rounded-md border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2">
                    <div class="min-w-0"><code class="block truncate text-[10px] text-[var(--text-main)]">{{ item.characterPath }}</code><div class="mt-1 text-[10px] text-[var(--text-muted)]">{{ item.outfitCount }} 个 outfit · {{ item.status }}</div></div>
                    <button type="button" class="h-8 shrink-0 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="action !== null || item.status === 'invalid_v2'" @click="void prepare(item.characterPath)">{{ item.status === "invalid_v2" ? "V2 文件无效" : "创建/恢复 proposal" }}</button>
                </div>
            </div>
            <div v-else-if="scan && scan.items.length > 0" class="rounded-md border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-2 text-[11px] text-[var(--status-success)]">当前扫描到的角色视觉文件均已是 V2。</div>
            <div v-else-if="scan && !loading" class="text-[11px] text-[var(--text-muted)]">当前 Project 没有 image-tags.md。</div>

            <!-- 外部公开角色视觉源沿用同一 candidate / Resolver / journal -->
            <TextToImageCharacterSourcePanel :project-path="projectPath" :scan="scan" @prepared="setSnapshot" />

            <!-- 当前 proposal 的服务端状态与 blocking report -->
            <div v-if="snapshot" class="space-y-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
                <div class="flex flex-wrap items-start justify-between gap-2"><div><div class="text-[11px] font-semibold text-[var(--text-main)]">{{ snapshot.candidate.character.names.cn || snapshot.candidate.character.names.en || snapshot.candidate.character.characterId }}</div><code class="text-[10px] text-[var(--text-muted)]">{{ snapshot.candidate.migrationId }}</code></div><span class="rounded-full border px-2 py-0.5 text-[10px]" :class="stageClass(snapshot.stage)">{{ snapshot.stage }}</span></div>
                <div v-for="issue in snapshot.candidate.issues" :key="`${issue.code}:${issue.path}`" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[10px] text-[var(--status-danger)]"><strong>{{ issue.code }}</strong> · {{ issue.path }}<div class="mt-1">{{ issue.message }}</div></div>

                <!-- Atom diff 与逐项 terminal 接受 -->
                <div v-if="snapshot.candidate.pendingAtoms.length > 0" class="max-h-96 space-y-1 overflow-y-auto pr-1">
                    <label v-for="item in snapshot.candidate.pendingAtoms" :key="item.resolutionKey" class="flex items-start gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-2 text-[10px] text-[var(--text-secondary)]">
                        <input v-if="snapshot.stage === 'ready'" v-model="acceptedKeys" type="checkbox" :value="item.resolutionKey" class="mt-0.5 accent-[var(--accent-main)]" />
                        <span v-else class="mt-0.5 h-3 w-3 shrink-0 rounded-full border border-[var(--border-color)]"></span>
                        <span class="min-w-0"><span class="font-medium text-[var(--text-main)]">{{ item.atom.sourceText }}</span><span v-if="item.syntax" class="ml-1 text-[var(--status-info)]">weight {{ item.syntax.weight }}</span><span class="mx-1 text-[var(--text-muted)]">→</span><span>{{ resolutionSummary(item.resolutionKey) }}</span><code class="mt-1 block truncate text-[9px] text-[var(--text-muted)]">{{ item.ownerPath }} · {{ item.atom.ownerSlot.field }}</code></span>
                    </label>
                </div>

                <!-- review_required 必须逐项勾选当前 review hash -->
                <div v-if="snapshot.stage === 'review_required'" class="space-y-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] p-3">
                    <label v-for="item in snapshot.reviews" :key="item.review.reviewRequestHash" class="flex items-start gap-2 text-[10px] text-[var(--status-warning)]"><input v-model="approvedReviewHashes" type="checkbox" :value="item.review.reviewRequestHash" class="mt-0.5 accent-[var(--accent-main)]" /><span><strong>{{ item.review.sourceText }}</strong>：{{ item.review.policy.decision }}<code class="mt-1 block break-all text-[9px]">{{ item.review.reviewRequestHash }}</code></span></label>
                    <textarea v-model="reviewReason" class="h-16 w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[10px] text-[var(--text-main)] outline-none focus:border-[var(--accent-main)]" maxlength="500"></textarea>
                </div>

                <div class="flex flex-wrap justify-end gap-2">
                    <button v-if="snapshot.stage === 'pending_unresolved'" type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="action !== null" @click="void resolveAtoms()">用 active Tag index 解析</button>
                    <button v-if="snapshot.stage === 'review_required'" type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="action !== null || !allReviewsApproved" @click="void resolveAtoms()">提交逐项审核并重解析</button>
                    <button v-if="snapshot.stage === 'ready'" type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[11px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="action !== null || !allTerminalAccepted" @click="void applyMigration()">确认全部 diff 并升级 V2</button>
                    <button v-if="snapshot.stage === 'applying'" type="button" class="h-8 rounded-md border border-[var(--status-info-border)] bg-[var(--status-info-bg)] px-3 text-[11px] font-medium text-[var(--status-info)] disabled:opacity-50" :disabled="action !== null" @click="void resumeMigration()">恢复 apply journal</button>
                </div>
            </div>
        </div>
    </section>
</template>
