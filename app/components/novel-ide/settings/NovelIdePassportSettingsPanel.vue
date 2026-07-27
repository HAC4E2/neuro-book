<script setup lang="ts">
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {DEFAULT_PASSPORT_SITE_URL} from "nbook/shared/passport/passport-constants";
import type {PassportBackupListDto, PassportJobDto, PassportLinkSessionDto, PassportStatusDto} from "nbook/shared/dto/passport.dto";

// NeuroBook 账号（Passport）设置面板：设备码流关联官方站 + 云备份/恢复管理。
// 无「保存」语义：全部操作即时生效，不接入设置对话框的 save bar。

const notification = useNotification();
const {t} = useI18n();

// ---- 关联状态 ----
const status = ref<PassportStatusDto | null>(null); // 为空表示尚未加载完成
const statusLoading = ref(false);
const siteUrlInput = ref(DEFAULT_PASSPORT_SITE_URL);

// ---- 设备码流会话 ----
const linkSession = ref<PassportLinkSessionDto | null>(null); // 为空表示无进行中的关联
const linkPhase = ref<"idle" | "waiting" | "expired" | "denied">("idle");
const linkBusy = ref(false);
let linkTimer: ReturnType<typeof setTimeout> | null = null;

// ---- 取消关联两步确认 ----
const confirmUnlink = ref(false);
const unlinkBusy = ref(false);

// ---- 云备份 ----
const backups = ref<PassportBackupListDto | null>(null);
const backupsLoading = ref(false);
const backupsError = ref("");
const backupComment = ref("");
const activeJob = ref<PassportJobDto | null>(null); // 进行中或刚结束的后台任务
let jobTimer: ReturnType<typeof setTimeout> | null = null;
const confirmRestoreId = ref<number | null>(null);
const confirmDeleteId = ref<number | null>(null);
// 恢复完成后的指引卡片（保留展示直到用户关闭）
const restoreResult = ref<{restoreDir: string; fileCount: number; appVersion: string} | null>(null);

const usagePercent = computed(() => {
    const quota = backups.value?.quota;
    if (!quota || quota.maxBytes <= 0) {
        return 0;
    }
    return Math.min(100, Math.round((quota.usedBytes / quota.maxBytes) * 100));
});

/**
 * 识别 409 passport_unlinked：凭据已失效，清空关联态并提示重新关联。
 */
function isUnlinkedError(error: unknown): boolean {
    const data = (error as {data?: {data?: {code?: string}}})?.data?.data;
    return data?.code === "passport_unlinked";
}

/**
 * 读取关联状态；已关联时顺带刷新备份列表。
 */
async function loadStatus(): Promise<void> {
    statusLoading.value = true;
    try {
        status.value = await $fetch<PassportStatusDto>("/api/passport/status");
        if (status.value.linked) {
            siteUrlInput.value = status.value.siteBaseUrl;
            void loadBackups();
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.loadFailed")));
    } finally {
        statusLoading.value = false;
    }
}

/**
 * 发起设备码流关联。
 */
async function startLink(): Promise<void> {
    linkBusy.value = true;
    try {
        linkSession.value = await $fetch<PassportLinkSessionDto>("/api/passport/link/start", {
            method: "POST",
            body: {siteBaseUrl: siteUrlInput.value},
        });
        linkPhase.value = "waiting";
        scheduleLinkPoll(linkSession.value.interval);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.linkStartFailed")));
    } finally {
        linkBusy.value = false;
    }
}

/**
 * 按 interval 调度下一次关联轮询。
 */
function scheduleLinkPoll(intervalSeconds: number): void {
    clearLinkTimer();
    linkTimer = setTimeout(() => void pollLink(), intervalSeconds * 1000);
}

/**
 * 轮询一次关联结果。
 */
async function pollLink(): Promise<void> {
    const session = linkSession.value;
    if (!session || linkPhase.value !== "waiting") {
        return;
    }
    try {
        const result = await $fetch<import("nbook/shared/dto/passport.dto").PassportLinkPollDto>("/api/passport/link/poll", {
            method: "POST",
            body: {linkSessionId: session.linkSessionId},
        });
        if (result.state === "pending") {
            scheduleLinkPoll(result.interval);
            return;
        }
        if (result.state === "linked") {
            status.value = result.status;
            linkSession.value = null;
            linkPhase.value = "idle";
            notification.success(t("settings.panels.passport.linkSuccess"));
            void loadBackups();
            return;
        }
        linkPhase.value = result.state; // expired / denied
    } catch (error) {
        // 会话失效（如实例重启）按过期处理；其余错误延后重试
        if ((error as {statusCode?: number})?.statusCode === 404 || (error as {status?: number})?.status === 404) {
            linkPhase.value = "expired";
            return;
        }
        scheduleLinkPoll(session.interval);
    }
}

/**
 * 放弃当前关联流程（服务端设备码留给官方站自然过期）。
 */
function cancelLink(): void {
    clearLinkTimer();
    linkSession.value = null;
    linkPhase.value = "idle";
}

function clearLinkTimer(): void {
    if (linkTimer !== null) {
        clearTimeout(linkTimer);
        linkTimer = null;
    }
}

/**
 * 取消关联（两步确认）：通知官方站吊销并删除本地凭据。
 */
async function unlink(): Promise<void> {
    if (!confirmUnlink.value) {
        confirmUnlink.value = true;
        return;
    }
    unlinkBusy.value = true;
    try {
        await $fetch("/api/passport/unlink", {method: "POST"});
        confirmUnlink.value = false;
        backups.value = null;
        restoreResult.value = null;
        notification.success(t("settings.panels.passport.unlinkSuccess"));
        await loadStatus();
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.unlinkFailed")));
    } finally {
        unlinkBusy.value = false;
    }
}

/**
 * 读取云备份列表与配额。
 */
async function loadBackups(): Promise<void> {
    backupsLoading.value = true;
    backupsError.value = "";
    try {
        backups.value = await $fetch<PassportBackupListDto>("/api/passport/backups");
    } catch (error) {
        if (isUnlinkedError(error)) {
            await loadStatus();
            notification.error(t("settings.panels.passport.relinkRequired"));
            return;
        }
        backupsError.value = resolveApiErrorMessage(error, t("settings.panels.passport.backupListFailed"));
    } finally {
        backupsLoading.value = false;
    }
}

/**
 * 发起云备份后台任务。
 */
async function startBackup(): Promise<void> {
    try {
        const {jobId} = await $fetch<{jobId: string}>("/api/passport/backups", {
            method: "POST",
            body: {comment: backupComment.value},
        });
        backupComment.value = "";
        restoreResult.value = null;
        await pollJob(jobId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.backupStartFailed")));
    }
}

/**
 * 发起恢复后台任务（两步确认）。
 */
async function startRestore(backupId: number): Promise<void> {
    if (confirmRestoreId.value !== backupId) {
        confirmRestoreId.value = backupId;
        confirmDeleteId.value = null;
        return;
    }
    confirmRestoreId.value = null;
    try {
        const {jobId} = await $fetch<{jobId: string}>(`/api/passport/backups/${backupId}/restore`, {method: "POST"});
        restoreResult.value = null;
        await pollJob(jobId);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.restoreStartFailed")));
    }
}

/**
 * 轮询后台任务直到结束。
 */
async function pollJob(jobId: string): Promise<void> {
    clearJobTimer();
    try {
        const job = await $fetch<PassportJobDto>(`/api/passport/backups/jobs/${jobId}`);
        activeJob.value = job;
        if (job.state === "running") {
            jobTimer = setTimeout(() => void pollJob(jobId), 1000);
            return;
        }
        if (job.state === "done") {
            if (job.kind === "backup") {
                notification.success(t("settings.panels.passport.backupDone"));
            }
            if (job.kind === "restore" && job.restore) {
                restoreResult.value = job.restore;
            }
            void loadBackups();
        }
        if (job.state === "error" && isUnlinkedErrorMessage(job.error)) {
            await loadStatus();
        }
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.jobPollFailed")));
        activeJob.value = null;
    }
}

/**
 * 后台任务错误信息里辨认「未关联」：任务内部无法抛 HTTP 409，只能靠文案兜底刷新状态。
 */
function isUnlinkedErrorMessage(message: string | null): boolean {
    return message !== null && message.includes("重新关联");
}

function clearJobTimer(): void {
    if (jobTimer !== null) {
        clearTimeout(jobTimer);
        jobTimer = null;
    }
}

/**
 * 删除云端备份（两步确认）。
 */
async function removeBackup(backupId: number): Promise<void> {
    if (confirmDeleteId.value !== backupId) {
        confirmDeleteId.value = backupId;
        confirmRestoreId.value = null;
        return;
    }
    confirmDeleteId.value = null;
    try {
        await $fetch(`/api/passport/backups/${backupId}`, {method: "DELETE"});
        notification.success(t("settings.panels.passport.deleteDone"));
        void loadBackups();
    } catch (error) {
        if (isUnlinkedError(error)) {
            await loadStatus();
            notification.error(t("settings.panels.passport.relinkRequired"));
            return;
        }
        notification.error(resolveApiErrorMessage(error, t("settings.panels.passport.deleteFailed")));
    }
}

/** 任务进度文案 */
const jobProgressText = computed(() => {
    const job = activeJob.value;
    if (!job || job.state !== "running") {
        return "";
    }
    const progress = job.progress;
    if (!progress) {
        return t("settings.panels.passport.jobPreparing");
    }
    const phaseText = t(`settings.panels.passport.phase.${progress.phase}`);
    if (progress.phase === "packing") {
        return `${phaseText} ${progress.done}/${progress.total ?? "?"}`;
    }
    if (progress.phase === "downloading" && progress.total) {
        return `${phaseText} ${formatBytes(progress.done)}/${formatBytes(progress.total)}`;
    }
    if (progress.phase === "unpacking") {
        return `${phaseText} ${progress.done}`;
    }
    return phaseText;
});

/** 字节数人性化展示 */
function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KiB", "MiB", "GiB"];
    let value = bytes;
    let unit = "B";
    for (const next of units) {
        if (value < 1024) {
            break;
        }
        value /= 1024;
        unit = next;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
}

function formatTime(iso: string | null): string {
    if (!iso) {
        return "-";
    }
    return new Date(iso).toLocaleString(undefined, {dateStyle: "short", timeStyle: "short"});
}

onMounted(() => void loadStatus());
onBeforeUnmount(() => {
    clearLinkTimer();
    clearJobTimer();
});
</script>

<template>
    <!-- NeuroBook 账号（Passport）设置面板 -->
    <div class="space-y-4 pt-1">
        <div class="max-w-xl">
            <h3 class="text-base font-semibold text-[var(--text-main)]">{{ t("settings.panels.passport.title") }}</h3>
            <p class="mt-1 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.passport.description") }}</p>
        </div>

        <div v-if="statusLoading && !status" class="flex min-h-[160px] items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--bg-panel)]">
            <span class="i-lucide-loader-2 h-6 w-6 animate-spin text-[var(--text-muted)]"></span>
        </div>

        <template v-else-if="status">
            <!-- 关联卡片 -->
            <section class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <!-- 已关联 -->
                <template v-if="status.linked">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="flex min-w-0 items-start gap-3">
                            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)]">
                                <span class="i-lucide-user-round-check h-4 w-4"></span>
                            </div>
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-sm font-semibold text-[var(--text-main)]">{{ status.account?.displayName || status.account?.username }}</span>
                                    <span class="text-xs text-[var(--text-muted)]">@{{ status.account?.username }}</span>
                                </div>
                                <p class="mt-1 truncate text-xs text-[var(--text-secondary)]">{{ status.siteBaseUrl }} · {{ t("settings.panels.passport.linkedAt") }} {{ formatTime(status.linkedAt) }}</p>
                                <div class="mt-1.5 flex flex-wrap gap-1.5">
                                    <span v-for="scope in status.scopes" :key="scope" class="rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{{ scope }}</span>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <button v-if="confirmUnlink" type="button" class="rounded-md border border-[var(--border-color)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="confirmUnlink = false">{{ t("common.cancel") }}</button>
                            <button type="button" class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium" :class="confirmUnlink ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" :disabled="unlinkBusy" @click="unlink">
                                <span class="i-lucide-unlink h-3.5 w-3.5"></span>{{ confirmUnlink ? t("settings.panels.passport.unlinkConfirm") : t("settings.panels.passport.unlink") }}
                            </button>
                        </div>
                    </div>
                </template>

                <!-- 关联进行中：展示 userCode 与批准页链接 -->
                <template v-else-if="linkSession && linkPhase === 'waiting'">
                    <div class="flex flex-col items-center gap-3 py-4 text-center">
                        <p class="text-sm text-[var(--text-secondary)]">{{ t("settings.panels.passport.waitingHint") }}</p>
                        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] px-6 py-3 font-mono text-2xl font-bold tracking-widest text-[var(--text-main)]">{{ linkSession.userCode }}</div>
                        <a :href="linkSession.verificationUriComplete" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-sm text-[var(--accent-text)] hover:underline">
                            <span class="i-lucide-external-link h-3.5 w-3.5"></span>{{ t("settings.panels.passport.openApprovePage") }}
                        </a>
                        <div class="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                            <span class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>{{ t("settings.panels.passport.waitingApproval") }}
                        </div>
                        <button type="button" class="text-xs text-[var(--text-muted)] hover:underline" @click="cancelLink">{{ t("common.cancel") }}</button>
                    </div>
                </template>

                <!-- 关联终态：过期 / 被拒绝 -->
                <template v-else-if="linkPhase === 'expired' || linkPhase === 'denied'">
                    <div class="flex flex-col items-center gap-2 py-4 text-center">
                        <span class="i-lucide-alert-circle h-8 w-8 text-[var(--status-danger)]"></span>
                        <p class="text-sm text-[var(--text-main)]">{{ linkPhase === "expired" ? t("settings.panels.passport.linkExpired") : t("settings.panels.passport.linkDenied") }}</p>
                        <button type="button" class="rounded-md border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="cancelLink">{{ t("settings.panels.passport.backToStart") }}</button>
                    </div>
                </template>

                <!-- 未关联 -->
                <template v-else>
                    <div class="flex flex-col gap-3">
                        <p class="text-xs text-[var(--text-secondary)]">{{ t("settings.panels.passport.unlinkedHint") }}</p>
                        <label class="max-w-md space-y-1.5">
                            <span class="text-xs font-medium text-[var(--text-secondary)]">{{ t("settings.panels.passport.siteUrl") }}</span>
                            <FormInput v-model="siteUrlInput" :placeholder="t('settings.panels.passport.siteUrlPlaceholder')" />
                        </label>
                        <div>
                            <button type="button" class="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" :disabled="linkBusy || !siteUrlInput.trim()" @click="startLink">
                                <span :class="linkBusy ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-link'" class="h-3.5 w-3.5"></span>{{ t("settings.panels.passport.linkAction") }}
                            </button>
                        </div>
                    </div>
                </template>
            </section>

            <!-- 云备份区（已关联时显示） -->
            <section v-if="status.linked" class="rounded-xl border border-[var(--border-color)] border-opacity-60 bg-[var(--bg-input)] bg-opacity-20 p-5 shadow-sm">
                <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent-bg)] text-[var(--accent-text)]">
                            <span class="i-lucide-cloud-upload h-3.5 w-3.5"></span>
                        </span>
                        <h4 class="text-xs font-bold tracking-wider text-[var(--text-main)]">{{ t("settings.panels.passport.backupTitle") }}</h4>
                    </div>
                    <div class="flex items-center gap-2">
                        <FormInput v-model="backupComment" class="w-48" :placeholder="t('settings.panels.passport.commentPlaceholder')" />
                        <button type="button" class="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50" :disabled="activeJob?.state === 'running'" @click="startBackup">
                            <span class="i-lucide-cloud-upload h-3.5 w-3.5"></span>{{ t("settings.panels.passport.backupNow") }}
                        </button>
                    </div>
                </div>
                <p class="mb-3 text-xs text-[var(--text-secondary)]">{{ t("settings.panels.passport.backupDescription") }}</p>

                <!-- 任务进度 / 结果 -->
                <div v-if="activeJob?.state === 'running'" class="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <span class="i-lucide-loader-2 h-3.5 w-3.5 animate-spin"></span>{{ jobProgressText }}
                </div>
                <div v-else-if="activeJob?.state === 'error'" class="mb-3 flex items-start gap-2 rounded-lg border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-xs text-[var(--status-danger)]">
                    <span class="i-lucide-alert-circle mt-0.5 h-3.5 w-3.5 shrink-0"></span>{{ activeJob.error }}
                </div>
                <div v-if="activeJob && activeJob.warnings.length > 0" class="mb-3 rounded-lg border border-[var(--status-warning-border,var(--border-color))] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                    <p v-for="warning in activeJob.warnings" :key="warning">{{ warning }}</p>
                </div>

                <!-- 恢复完成指引 -->
                <div v-if="restoreResult" class="mb-3 rounded-lg border border-[var(--accent-main)] bg-[var(--bg-panel)] p-4 text-xs">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <p class="flex items-center gap-1.5 font-semibold text-[var(--text-main)]"><span class="i-lucide-check-circle-2 h-4 w-4 text-[var(--status-success)]"></span>{{ t("settings.panels.passport.restoreDoneTitle") }}</p>
                        <button type="button" class="text-[var(--text-muted)] hover:text-[var(--text-main)]" @click="restoreResult = null"><span class="i-lucide-x h-3.5 w-3.5"></span></button>
                    </div>
                    <p class="text-[var(--text-secondary)]">{{ t("settings.panels.passport.restoreDoneDir") }}</p>
                    <p class="mt-1 break-all rounded bg-[var(--bg-input)] px-2 py-1 font-mono text-[var(--text-main)]">{{ restoreResult.restoreDir }}</p>
                    <ol class="mt-2 list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
                        <li>{{ t("settings.panels.passport.restoreStep1") }}</li>
                        <li>{{ t("settings.panels.passport.restoreStep2") }}</li>
                        <li>{{ t("settings.panels.passport.restoreStep3") }}</li>
                    </ol>
                    <p class="mt-2 text-[var(--status-danger)]">{{ t("settings.panels.passport.restoreSecretsWarning") }}</p>
                </div>

                <!-- 配额用量 -->
                <div v-if="backups" class="mb-3 flex flex-col gap-1.5">
                    <div class="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                        <span>{{ t("settings.panels.passport.quotaUsage") }}</span>
                        <span>{{ formatBytes(backups.quota.usedBytes) }} / {{ formatBytes(backups.quota.maxBytes) }} · {{ backups.quota.count }}/{{ backups.quota.maxCount }}</span>
                    </div>
                    <div class="h-1.5 overflow-hidden rounded-full bg-[var(--bg-input)]">
                        <div class="h-full rounded-full bg-[var(--accent-main)] transition-all" :style="{width: `${usagePercent}%`}"></div>
                    </div>
                </div>

                <div v-if="backupsError" class="mb-3 text-xs text-[var(--status-danger)]">{{ backupsError }}</div>
                <div v-if="backupsLoading && !backups" class="flex justify-center py-4"><span class="i-lucide-loader-2 h-5 w-5 animate-spin text-[var(--text-muted)]"></span></div>

                <!-- 备份列表 -->
                <p v-if="backups && backups.items.length === 0" class="py-2 text-center text-xs text-[var(--text-muted)]">{{ t("settings.panels.passport.noBackups") }}</p>
                <ul v-else-if="backups" class="flex flex-col gap-2">
                    <li v-for="backup in backups.items" :key="backup.id" class="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] px-3 py-2 text-xs">
                        <span class="i-lucide-archive h-3.5 w-3.5 shrink-0 text-[var(--accent-text)]"></span>
                        <span class="font-medium text-[var(--text-main)]">{{ backup.instanceLabel }}</span>
                        <span class="text-[var(--text-muted)]">{{ formatBytes(backup.fileSize) }} · v{{ backup.appVersion }} · {{ formatTime(backup.createdAt) }}</span>
                        <span v-if="backup.comment" class="truncate text-[var(--text-secondary)]">{{ backup.comment }}</span>
                        <span class="flex-1"></span>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium" :class="confirmRestoreId === backup.id ? 'border-[var(--accent-main)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" :disabled="activeJob?.state === 'running'" @click="startRestore(backup.id)">
                            <span class="i-lucide-history h-3 w-3"></span>{{ confirmRestoreId === backup.id ? t("settings.panels.passport.restoreConfirm") : t("settings.panels.passport.restore") }}
                        </button>
                        <button type="button" class="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium" :class="confirmDeleteId === backup.id ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]' : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="removeBackup(backup.id)">
                            <span class="i-lucide-trash-2 h-3 w-3"></span>{{ confirmDeleteId === backup.id ? t("settings.panels.passport.deleteConfirm") : t("settings.panels.passport.delete") }}
                        </button>
                    </li>
                </ul>
            </section>
        </template>
    </div>
</template>
