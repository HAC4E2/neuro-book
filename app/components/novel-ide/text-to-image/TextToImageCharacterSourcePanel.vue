<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {CharacterVisualMigrationScan, CharacterVisualMigrationSnapshot} from "nbook/shared/text-to-image-character-migration";
import type {
    CharacterVisualMergeDecision,
    CharacterVisualMergeField,
    CharacterVisualSourceInspection,
    CharacterVisualSourceMergePreview,
} from "nbook/shared/text-to-image-character-source";

const props = defineProps<{projectPath: string; scan: CharacterVisualMigrationScan | null}>();
const emit = defineEmits<{prepared: [snapshot: CharacterVisualMigrationSnapshot]}>();
const sourcePath = ref("");
const sourceCharacterId = ref("");
const characterPath = ref("");
const inspection = ref<CharacterVisualSourceInspection | null>(null);
const preview = ref<CharacterVisualSourceMergePreview | null>(null);
const decisions = ref<Partial<Record<CharacterVisualMergeField, CharacterVisualMergeDecision["choice"]>>>({});
const action = ref<"inspect" | "preview" | "prepare" | null>(null);
const error = ref("");

const availableTargets = computed(() => inspection.value?.targets.filter((target) => target.status === "legacy" || target.status === "missing_visual") ?? []);
const allConflictsDecided = computed(() => preview.value?.rows
    .filter((row) => row.decisionRequired)
    .every((row) => Boolean(decisions.value[row.field])) ?? false);

watch(() => props.projectPath, reset, {immediate: true});
watch(() => props.scan?.sourcePaths, (paths) => {
    if (!paths?.includes(sourcePath.value)) sourcePath.value = paths?.[0] ?? "";
}, {immediate: true});

/** Project 或 source 改变后丢弃所有短生命周期预览与冲突决策。 */
function reset(): void {
    sourcePath.value = props.scan?.sourcePaths[0] ?? "";
    sourceCharacterId.value = "";
    characterPath.value = "";
    inspection.value = null;
    preview.value = null;
    decisions.value = {};
    error.value = "";
}

/** Strict inspect 只读解析公开明文 export，不创建候选。 */
async function inspectSource(): Promise<void> {
    if (!sourcePath.value || action.value) return;
    action.value = "inspect";
    error.value = "";
    preview.value = null;
    decisions.value = {};
    try {
        inspection.value = await $fetch<CharacterVisualSourceInspection>("/api/text-to-image/character-visual-migrations/source-inspect", {
            method: "POST",
            body: {projectPath: props.projectPath, sourcePath: sourcePath.value},
        });
        sourceCharacterId.value = inspection.value.source.characters[0]?.sourceCharacterId ?? "";
        characterPath.value = availableTargets.value[0]?.characterPath ?? "";
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "检查角色视觉源失败");
    } finally {
        action.value = null;
    }
}

/** 服务端重建 target base 与冲突字段，客户端不保存第二份 merge 真相。 */
async function previewMerge(): Promise<void> {
    if (!sourceCharacterId.value || !characterPath.value || action.value) return;
    action.value = "preview";
    error.value = "";
    decisions.value = {};
    try {
        preview.value = await $fetch<CharacterVisualSourceMergePreview>("/api/text-to-image/character-visual-migrations/source-preview", {
            method: "POST",
            body: {
                projectPath: props.projectPath,
                sourcePath: sourcePath.value,
                sourceCharacterId: sourceCharacterId.value,
                characterPath: characterPath.value,
            },
        });
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "创建角色视觉合并预览失败");
    } finally {
        action.value = null;
    }
}

/** 只提交当前 preview hash 和全部 conflict 决策，candidate 仍由服务端确定性重建。 */
async function prepareSource(): Promise<void> {
    const current = preview.value;
    if (!current || !allConflictsDecided.value || action.value) return;
    action.value = "prepare";
    error.value = "";
    try {
        const result = await $fetch<CharacterVisualMigrationSnapshot>("/api/text-to-image/character-visual-migrations/source-prepare", {
            method: "POST",
            body: {
                projectPath: props.projectPath,
                sourcePath: current.sourcePath,
                sourceCharacterId: current.sourceCharacterId,
                characterPath: current.characterPath,
                expectedMergePreviewHash: current.mergePreviewHash,
                decisions: current.rows.filter((row) => row.decisionRequired).map((row) => ({
                    field: row.field,
                    choice: decisions.value[row.field],
                })),
            },
        });
        emit("prepared", result);
    } catch (caught) {
        error.value = resolveApiErrorMessage(caught, "创建外部角色视觉迁移 proposal 失败");
    } finally {
        action.value = null;
    }
}

/** 固定字段显示名，避免把外部源自由文本用作 UI 标题。 */
function fieldLabel(field: CharacterVisualMergeField): string {
    return {
        profileTraits: "角色特征", facialAppearance: "五官正面", facialBack: "五官背面",
        upperSfw: "上身 SFW", upperBackSfw: "上身背面 SFW", lowerSfw: "全身 SFW",
        lowerBackSfw: "全身背面 SFW", upperNsfw: "上身 NSFW", upperBackNsfw: "上身背面 NSFW",
        lowerNsfw: "全身 NSFW", lowerBackNsfw: "全身背面 NSFW", negativePrompt: "负向提示",
    }[field];
}
</script>

<template>
    <div class="space-y-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-3">
        <!-- 公开明文角色视觉源检查入口 -->
        <div><div class="text-[11px] font-semibold text-[var(--text-main)]">公开角色视觉源</div><p class="m-0 mt-1 text-[10px] text-[var(--text-muted)]">只接受 Project upload 顶层的公开明文 JSON；源、目标和冲突决策都会绑定服务端 hash。</p></div>
        <div v-if="error" class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[10px] text-[var(--status-danger)]">{{ error }}</div>
        <div v-if="scan?.sourcePaths.length" class="flex flex-wrap gap-2">
            <select v-model="sourcePath" class="h-8 min-w-56 flex-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-main)]" @change="inspection = null; preview = null; decisions = {}"><option v-for="item in scan.sourcePaths" :key="item" :value="item">{{ item }}</option></select>
            <button type="button" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 text-[10px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="Boolean(action)" @click="void inspectSource()">Strict inspect</button>
        </div>
        <div v-else class="text-[10px] text-[var(--text-muted)]">upload 顶层没有可检查的 JSON。</div>

        <!-- Source diagnostics 与角色/目标选择 -->
        <template v-if="inspection">
            <div v-for="diagnostic in inspection.source.diagnostics" :key="`${diagnostic.code}:${diagnostic.scope}:${diagnostic.sourceKey}`" class="rounded-md border px-3 py-2 text-[10px]" :class="diagnostic.code === 'IMAGES_IGNORED' ? 'border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info)]' : 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]'"><strong>{{ diagnostic.code }}</strong> · {{ diagnostic.message }}</div>
            <div v-if="inspection.source.state === 'proposal_ready'" class="grid gap-2 lg:grid-cols-[1fr_1fr_auto]">
                <select v-model="sourceCharacterId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-main)]" @change="preview = null; decisions = {}"><option v-for="item in inspection.source.characters" :key="item.sourceCharacterId" :value="item.sourceCharacterId">{{ item.names.cn || item.names.en || item.sourceKey }}</option></select>
                <select v-model="characterPath" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-main)]" @change="preview = null; decisions = {}"><option v-for="item in availableTargets" :key="item.characterPath" :value="item.characterPath">{{ item.characterId }} · {{ item.status }}</option></select>
                <button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[10px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="Boolean(action) || !sourceCharacterId || !characterPath" @click="void previewMerge()">预览合并</button>
            </div>
            <div v-else class="rounded-md border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] px-3 py-2 text-[10px] text-[var(--status-danger)]">该源只能生成检查报告，不能创建迁移 proposal。</div>
        </template>

        <!-- 字段冲突逐项决策；非冲突行完全只读 -->
        <div v-if="preview" class="space-y-2 border-t border-[var(--border-color)] pt-3">
            <div class="text-[10px] text-[var(--text-muted)]">目标 {{ preview.characterPath }} · {{ preview.targetStatus }} · 新增 {{ preview.outfits.length }} 个 create-only outfit</div>
            <div v-for="row in preview.rows" :key="row.field" class="grid gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[10px] lg:grid-cols-[7rem_1fr_1fr]">
                <div class="font-medium text-[var(--text-main)]">{{ fieldLabel(row.field) }}<div class="mt-1 text-[9px] text-[var(--text-muted)]">{{ row.state }}</div></div>
                <label class="space-y-1 text-[var(--text-secondary)]"><span>保留 Project</span><textarea :value="row.existingText" readonly class="h-16 w-full resize-none rounded border border-[var(--border-color)] bg-[var(--bg-card)] p-1.5 text-[9px] text-[var(--text-main)]"></textarea><input v-if="row.decisionRequired" v-model="decisions[row.field]" type="radio" :name="`merge-${row.field}`" value="keep_existing" class="accent-[var(--accent-main)]" /> <span v-if="row.decisionRequired">选择此项</span></label>
                <label class="space-y-1 text-[var(--text-secondary)]"><span>使用外部 proposal</span><textarea :value="row.proposalText" readonly class="h-16 w-full resize-none rounded border border-[var(--border-color)] bg-[var(--bg-card)] p-1.5 text-[9px] text-[var(--text-main)]"></textarea><input v-if="row.decisionRequired" v-model="decisions[row.field]" type="radio" :name="`merge-${row.field}`" value="use_proposal" class="accent-[var(--accent-main)]" /> <span v-if="row.decisionRequired">选择此项</span></label>
            </div>
            <div class="flex justify-end"><button type="button" class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[10px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="Boolean(action) || !allConflictsDecided" @click="void prepareSource()">确认冲突决策并创建 proposal</button></div>
        </div>
    </div>
</template>
