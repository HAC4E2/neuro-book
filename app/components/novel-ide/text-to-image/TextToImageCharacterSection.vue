<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import type {CharacterGenerationContext} from "nbook/app/components/novel-ide/text-to-image/character-context";
import {
    characterDetailFieldGroups,
    characterDetailFieldLabels,
    characterWorkbenchSections,
    type CharacterFieldKey,
    type CharacterWorkbenchSectionId,
    outfitDetailFields,
} from "nbook/app/components/novel-ide/text-to-image/character-workbench";

const props = defineProps<{
    projectRoot: string;
    initialCharacter?: CharacterGenerationContext | null;
}>();

type CharacterGroup = {
    groupId: string;
    name: string;
    description: string;
    enabled: boolean;
    sortOrder: number;
    characterCount: number;
    characters: CharacterTreeItem[];
};

type CharacterTreeItem = {
    characterId: string;
    files: VisualFileInfo[];
};

type VisualFileInfo = {
    visualId: string;
    fileName: string;
    createdAt: string;
    updatedAt: string;
    source: "manual" | "llm" | "migration" | "copy";
    active: boolean;
    invalid?: boolean;
};

type CharacterOutfit = {
    cnName: string;
    enName: string;
    upper: string;
    upperBack: string;
    lower: string;
    lowerBack: string;
};

type CharacterVisual = {
    schema: "nbook.character-visual/v1";
    visualId?: string;
    characterId: string;
    character: Record<CharacterFieldKey, string>;
    outfits: CharacterOutfit[];
    photos: string[];
};

type PendingDraft = {
    draft: CharacterVisual;
    current: CharacterVisual | null;
    baseRevision: string | null;
    currentFile: VisualFileInfo | null;
};

const defaultCharacterFields: Record<CharacterFieldKey, string> = {
    cnName: "",
    enName: "",
    triggerWords: "",
    profileTraits: "",
    facialAppearance: "",
    facialBack: "",
    upperSfw: "",
    upperBackSfw: "",
    lowerSfw: "",
    lowerBackSfw: "",
    upperNsfw: "",
    upperBackNsfw: "",
    lowerNsfw: "",
    lowerBackNsfw: "",
    negativePrompt: "",
};

const defaultOutfit: CharacterOutfit = {
    cnName: "",
    enName: "",
    upper: "",
    upperBack: "",
    lower: "",
    lowerBack: "",
};

const groups = ref<CharacterGroup[]>([]);
const expandedGroupIds = ref<string[]>([]);
const expandedCharacterKeys = ref<string[]>([]);
const activeGroupId = ref("");
const activeCharacterId = ref("");
const activeVisualId = ref("");
const visualFiles = ref<VisualFileInfo[]>([]);
const character = ref({...defaultCharacterFields});
const outfits = ref<CharacterOutfit[]>([]);
const photos = ref<string[]>([]);
const characterPage = ref("");
const userRequirement = ref("");
const photoPrompt = ref("");
const newGroupId = ref("");
const newGroupName = ref("");
const targetGroupId = ref("");
const activeOutfitIndex = ref(-1);
const outfitDraft = ref<CharacterOutfit>({...defaultOutfit});
const subTab = ref<CharacterWorkbenchSectionId>("character");
const selectedFile = ref<VisualFileInfo | null>(null);
const pendingDraft = ref<PendingDraft | null>(null);
const error = ref("");
const loading = ref(false);
const saving = ref(false);
const dirty = ref(false);

const activeGroup = computed(() => groups.value.find((group) => group.groupId === activeGroupId.value) ?? null);
const activeCharacter = computed(() => activeGroup.value?.characters.find((item) => item.characterId === activeCharacterId.value) ?? null);
const activeOutfit = computed(() => (
    activeOutfitIndex.value >= 0 && activeOutfitIndex.value < outfits.value.length
        ? outfits.value[activeOutfitIndex.value]
        : null
));
const effectiveCharacters = computed(() => {
    const seen = new Set<string>();
    const result: Array<{characterId: string; groupId: string; groupName: string; file: VisualFileInfo}> = [];
    for (const group of [...groups.value].sort((left, right) => left.sortOrder - right.sortOrder)) {
        if (!group.enabled) continue;
        for (const item of group.characters) {
            if (seen.has(item.characterId)) continue;
            const file = item.files.find((candidate) => candidate.active) ?? item.files[0];
            if (!file) continue;
            seen.add(item.characterId);
            result.push({characterId: item.characterId, groupId: group.groupId, groupName: group.name, file});
        }
    }
    return result;
});
const enabledGroupIds = computed(() => groups.value.filter((group) => group.enabled).map((group) => group.groupId));
const hasConflict = computed(() => {
    const counts = new Map<string, number>();
    for (const group of groups.value) {
        if (!group.enabled) continue;
        for (const item of group.characters) counts.set(item.characterId, (counts.get(item.characterId) ?? 0) + 1);
    }
    return [...counts.values()].some((count) => count > 1);
});
const draftChanges = computed(() => {
    const pending = pendingDraft.value;
    if (!pending) return [] as Array<{label: string; before: string; after: string}>;
    const changes: Array<{label: string; before: string; after: string}> = [];
    const before = pending.current?.character ?? defaultCharacterFields;
    for (const key of Object.keys(defaultCharacterFields) as CharacterFieldKey[]) {
        const previous = before[key] ?? "";
        const next = pending.draft.character[key] ?? "";
        if (previous !== next) changes.push({label: characterDetailFieldLabels[key], before: previous, after: next});
    }
    if (JSON.stringify(pending.current?.outfits ?? []) !== JSON.stringify(pending.draft.outfits)) {
        changes.push({
            label: "服装列表",
            before: `${pending.current?.outfits.length ?? 0} 套`,
            after: `${pending.draft.outfits.length} 套`,
        });
    }
    return changes;
});

onMounted(() => void loadLibrary());
watch(() => props.projectRoot, () => void loadLibrary());
watch(() => props.initialCharacter, () => void applyInitialCharacter(), {immediate: true});
watch(activeOutfitIndex, syncOutfitDraft, {immediate: true});

async function loadLibrary(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<{groups: CharacterGroup[]}>("/api/text-to-image/character-library", {
            query: {projectRoot: props.projectRoot},
        });
        groups.value = result.groups;
        expandedGroupIds.value = expandedGroupIds.value.filter((id) => groups.value.some((group) => group.groupId === id));
        if (groups.value.length > 0 && !activeGroupId.value) activeGroupId.value = groups.value[0]!.groupId;
        if (!targetGroupId.value || targetGroupId.value === activeGroupId.value) {
            targetGroupId.value = groups.value.find((group) => group.groupId !== activeGroupId.value)?.groupId ?? "";
        }
        await applyInitialCharacter();
        if (!activeCharacterId.value) {
            const firstGroup = groups.value.find((group) => group.characters.length > 0);
            const firstCharacter = firstGroup?.characters[0];
            const firstFile = firstCharacter?.files[0];
            if (firstGroup && firstCharacter && firstFile) {
                await selectVisual(firstGroup.groupId, firstCharacter.characterId, firstFile.visualId);
            }
        } else {
            const current = activeCharacter?.files.find((file) => file.visualId === activeVisualId.value) ?? activeCharacter?.files[0];
            if (current) await selectVisual(activeGroupId.value, activeCharacterId.value, current.visualId);
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加载角色视觉资料失败");
    } finally {
        loading.value = false;
    }
}

async function applyInitialCharacter(): Promise<void> {
    const context = props.initialCharacter;
    if (!context || groups.value.length === 0) return;
    const groupId = context.groupId && groups.value.some((group) => group.groupId === context.groupId)
        ? context.groupId
        : "default";
    const group = groups.value.find((item) => item.groupId === groupId);
    const characterItem = group?.characters.find((item) => item.characterId === context.characterId);
    const file = characterItem?.files.find((item) => item.active) ?? characterItem?.files[0];
    characterPage.value = context.characterPage;
    activeGroupId.value = group?.groupId ?? "default";
    activeCharacterId.value = context.characterId;
    if (group && characterItem && file) {
        await selectVisual(group.groupId, characterItem.characterId, file.visualId);
    } else {
        activeVisualId.value = "";
        selectedFile.value = null;
        visualFiles.value = [];
        resetForm();
    }
}

function groupExpanded(groupId: string): boolean {
    return expandedGroupIds.value.includes(groupId);
}

function characterExpanded(groupId: string, characterId: string): boolean {
    return expandedCharacterKeys.value.includes(`${groupId}\u0000${characterId}`);
}

function toggleGroup(groupId: string): void {
    expandedGroupIds.value = groupExpanded(groupId)
        ? expandedGroupIds.value.filter((id) => id !== groupId)
        : [...expandedGroupIds.value, groupId];
}

function toggleCharacter(groupId: string, characterId: string): void {
    const key = `${groupId}\u0000${characterId}`;
    expandedCharacterKeys.value = characterExpanded(groupId, characterId)
        ? expandedCharacterKeys.value.filter((item) => item !== key)
        : [...expandedCharacterKeys.value, key];
}

async function selectVisual(groupId: string, characterId: string, visualId: string): Promise<void> {
    if (!await confirmDiscardIfDirty()) return;
    activeGroupId.value = groupId;
    activeCharacterId.value = characterId;
    activeVisualId.value = visualId;
    if (!expandedGroupIds.value.includes(groupId)) expandedGroupIds.value.push(groupId);
    const key = `${groupId}\u0000${characterId}`;
    if (!expandedCharacterKeys.value.includes(key)) expandedCharacterKeys.value.push(key);
    await loadVisual();
}

async function loadVisual(): Promise<void> {
    if (!activeGroupId.value || !activeCharacterId.value || !activeVisualId.value) return;
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<{visual: CharacterVisual | null; file: VisualFileInfo | null; files: VisualFileInfo[]}>("/api/text-to-image/character-library/files", {
            query: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
            },
        });
        selectedFile.value = result.file;
        visualFiles.value = result.files;
        if (result.visual) {
            character.value = {...defaultCharacterFields, ...result.visual.character};
            outfits.value = result.visual.outfits.map((item) => ({...item}));
            photos.value = [...result.visual.photos];
            activeVisualId.value = result.visual.visualId ?? activeVisualId.value;
        } else {
            resetForm();
        }
        dirty.value = false;
        activeOutfitIndex.value = outfits.value.length > 0 ? 0 : -1;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取角色视觉资料失败");
    } finally {
        loading.value = false;
    }
}

function resetForm(): void {
    character.value = {...defaultCharacterFields};
    outfits.value = [];
    photos.value = [];
    activeOutfitIndex.value = -1;
    photoPrompt.value = "";
}

function syncOutfitDraft(): void {
    outfitDraft.value = activeOutfit.value ? {...activeOutfit.value} : {...defaultOutfit};
}

function applyOutfitDraft(): void {
    if (activeOutfitIndex.value < 0 || activeOutfitIndex.value >= outfits.value.length) return;
    outfits.value[activeOutfitIndex.value] = {...outfitDraft.value};
    dirty.value = true;
}

function buildVisual(): CharacterVisual {
    applyOutfitDraft();
    return {
        schema: "nbook.character-visual/v1",
        visualId: activeVisualId.value || undefined,
        characterId: activeCharacterId.value,
        character: {...character.value},
        outfits: outfits.value.map((item) => ({...item})),
        photos: [...photos.value],
    };
}

async function saveVisual(): Promise<void> {
    if (!activeGroupId.value || !activeCharacterId.value || !activeVisualId.value || !selectedFile.value) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual", {
            method: "PUT",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
                expectedUpdatedAt: selectedFile.value.updatedAt,
                setActive: false,
                visual: buildVisual(),
            },
        });
        dirty.value = false;
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存视觉资料失败");
    } finally {
        saving.value = false;
    }
}

async function renameVisual(): Promise<void> {
    if (!selectedFile.value) return;
    const nextName = window.prompt("请输入新的 JSON 文件名", selectedFile.value.fileName);
    if (!nextName || nextName.trim() === selectedFile.value.fileName) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual/rename", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
                fileName: nextName.trim(),
            },
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "重命名视觉资料失败");
    } finally {
        saving.value = false;
    }
}

async function deleteVisual(): Promise<void> {
    if (!selectedFile.value || visualFiles.value.length <= 1 || selectedFile.value.active) return;
    if (!confirm(`确定删除“${selectedFile.value.fileName}”？照片登记也会一并移除。`)) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual/delete", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
            },
        });
        const fallback = visualFiles.value.find((file) => file.active && file.visualId !== activeVisualId.value)
            ?? visualFiles.value.find((file) => file.visualId !== activeVisualId.value);
        activeVisualId.value = fallback?.visualId ?? "";
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除视觉资料失败");
    } finally {
        saving.value = false;
    }
}

async function setActiveVisual(): Promise<void> {
    if (!activeVisualId.value) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual/active", {
            method: "PUT",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
            },
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "设置当前视觉资料失败");
    } finally {
        saving.value = false;
    }
}

async function copyVisualToGroup(): Promise<void> {
    if (!selectedFile.value || !activeGroupId.value || !activeCharacterId.value || !targetGroupId.value) return;
    if (targetGroupId.value === activeGroupId.value) {
        error.value = "目标分组必须与当前分组不同";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual/copy", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                sourceGroupId: activeGroupId.value,
                sourceCharacterId: activeCharacterId.value,
                sourceVisualId: activeVisualId.value,
                targetGroupId: targetGroupId.value,
            },
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加入角色分组失败");
    } finally {
        saving.value = false;
    }
}

async function createGroup(): Promise<void> {
    const groupId = newGroupId.value.trim();
    if (!groupId) {
        error.value = "请输入分组 ID";
        return;
    }
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-library/groups", {
            method: "POST",
            body: {projectRoot: props.projectRoot, groupId, name: newGroupName.value.trim() || groupId},
        });
        newGroupId.value = "";
        newGroupName.value = "";
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "创建角色分组失败");
    } finally {
        saving.value = false;
    }
}

async function renameGroup(group: CharacterGroup): Promise<void> {
    const name = window.prompt("请输入分组显示名称", group.name)?.trim();
    if (!name || name === group.name) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/groups", {
            method: "PUT",
            body: {projectRoot: props.projectRoot, groupId: group.groupId, name},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "重命名角色分组失败");
    } finally {
        saving.value = false;
    }
}

async function deleteGroup(group: CharacterGroup): Promise<void> {
    if (group.groupId === "default" || group.characterCount > 0) return;
    if (!confirm(`确定删除分组“${group.name}”？`)) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/groups", {
            method: "DELETE",
            body: {projectRoot: props.projectRoot, groupId: group.groupId},
        });
        if (activeGroupId.value === group.groupId) activeGroupId.value = "default";
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除角色分组失败");
    } finally {
        saving.value = false;
    }
}

async function moveGroup(group: CharacterGroup, direction: -1 | 1): Promise<void> {
    const ordered = [...groups.value].sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((item) => item.groupId === group.groupId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-library/groups/reorder", {
            method: "PUT",
            body: {projectRoot: props.projectRoot, orderedGroupIds: ordered.map((item) => item.groupId)},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "调整角色分组顺序失败");
    } finally {
        saving.value = false;
    }
}

async function toggleGroupEnabled(group: CharacterGroup): Promise<void> {
    saving.value = true;
    error.value = "";
    try {
        const enabledGroupIds = group.enabled
            ? enabledGroupIds.value.filter((id) => id !== group.groupId)
            : [...enabledGroupIds.value, group.groupId];
        await $fetch("/api/text-to-image/character-library/activation", {
            method: "PUT",
            body: {projectRoot: props.projectRoot, enabledGroupIds},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "更新启用分组失败");
    } finally {
        saving.value = false;
    }
}

async function enableOnly(group: CharacterGroup): Promise<void> {
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-library/activation", {
            method: "PUT",
            body: {projectRoot: props.projectRoot, enabledGroupIds: [group.groupId]},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "更新启用分组失败");
    } finally {
        saving.value = false;
    }
}

async function generateVisual(): Promise<void> {
    if (!activeCharacterId.value) {
        error.value = "请先选择角色视觉资料";
        return;
    }
    if (!characterPage.value.trim() && !userRequirement.value.trim()) {
        error.value = "请提供角色原始档案或本次修改要求";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{visual: CharacterVisual; current: CharacterVisual | null; currentFile: VisualFileInfo | null; baseRevision: string | null}>("/api/text-to-image/character-visual.generate", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value || "default",
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value || undefined,
                characterPage: characterPage.value,
                mode: activeVisualId.value ? "replace_visual" : "fill_empty",
                userRequirement: userRequirement.value,
            },
        });
        pendingDraft.value = {
            draft: result.visual,
            current: result.current,
            currentFile: result.currentFile,
            baseRevision: result.baseRevision,
        };
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色视觉修改草稿失败");
    } finally {
        saving.value = false;
    }
}

async function commitDraft(action: "overwrite" | "create_new"): Promise<void> {
    const pending = pendingDraft.value;
    if (!pending) return;
    if (action === "overwrite" && !activeVisualId.value) {
        error.value = "当前没有可覆盖的视觉资料，请选择另存为新设计";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{ref: {visualId: string}}>("/api/text-to-image/character-visual.modify-commit", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value || "default",
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value || undefined,
                action,
                expectedUpdatedAt: pending.baseRevision ?? undefined,
                draft: pending.draft,
            },
        });
        pendingDraft.value = null;
        activeVisualId.value = result.ref.visualId;
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "提交视觉资料修改失败");
    } finally {
        saving.value = false;
    }
}

async function generatePhotoPrompt(): Promise<void> {
    try {
        const result = await $fetch<{prompt: string}>("/api/text-to-image/character-photo.generate-prompt", {
            method: "POST",
            body: {
                characterText: JSON.stringify(character.value),
                outfitText: JSON.stringify(activeOutfit.value ?? {}),
                userRequirement: userRequirement.value,
            },
        });
        photoPrompt.value = result.prompt;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成照片 prompt 失败");
    }
}

async function generateAvatar(): Promise<void> {
    if (!activeVisualId.value) return;
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-photo.generate", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                visualId: activeVisualId.value,
                characterId: activeCharacterId.value,
                characterText: JSON.stringify(character.value),
                outfitText: JSON.stringify(activeOutfit.value ?? {}),
                userRequirement: userRequirement.value,
            },
        });
        await loadVisual();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色照片失败");
    } finally {
        saving.value = false;
    }
}

function addOutfit(): void {
    outfits.value.push({...defaultOutfit});
    activeOutfitIndex.value = outfits.value.length - 1;
    dirty.value = true;
}

function removeOutfit(index: number): void {
    outfits.value.splice(index, 1);
    activeOutfitIndex.value = Math.min(activeOutfitIndex.value, outfits.value.length - 1);
    syncOutfitDraft();
    dirty.value = true;
}

function photoUrl(photo: string): string {
    return `/api/text-to-image/assets/by-path/content?projectRoot=${encodeURIComponent(props.projectRoot)}&relativePath=${encodeURIComponent(photo)}`;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
    if (!dirty.value) return true;
    return confirm("当前视觉资料有未保存修改，是否放弃这些修改？");
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3">
            <div class="min-w-0">
                <h2 class="truncate text-[18px] font-semibold text-[var(--text-main)]">角色管理</h2>
                <p class="mt-1 truncate text-[13px] text-[var(--text-muted)]">
                    {{ activeGroup?.name || "视觉资料库" }}
                    <span v-if="activeCharacterId"> · {{ activeCharacterId }}</span>
                    <span v-if="selectedFile"> · {{ selectedFile.fileName }}</span>
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving || !activeVisualId || !dirty" @click="saveVisual">
                    <span class="i-lucide-save h-4 w-4"></span>保存
                </button>
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving || !selectedFile" @click="renameVisual">
                    <span class="i-lucide-file-pen h-4 w-4"></span>重命名 JSON
                </button>
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger-border)] px-3 text-[14px] text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-50" :disabled="saving || !selectedFile || selectedFile.active || visualFiles.length <= 1" @click="void deleteVisual">
                    <span class="i-lucide-trash-2 h-4 w-4"></span>删除 JSON
                </button>
                <button class="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[14px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving || !activeVisualId || selectedFile?.active" @click="setActiveVisual">
                    <span class="i-lucide-badge-check h-4 w-4"></span>设为当前使用
                </button>
            </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside class="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-[var(--border-color)] p-3 lg:w-80 lg:border-b-0 lg:border-r">
                <section>
                    <div class="mb-2 flex items-center justify-between">
                        <div>
                            <h3 class="text-[15px] font-semibold text-[var(--text-main)]">视觉资料</h3>
                            <p class="mt-1 text-[12px] text-[var(--text-muted)]">分组 → 角色 → JSON 文件</p>
                        </div>
                        <span class="i-lucide-folder-tree h-4 w-4 text-[var(--accent-text)]"></span>
                    </div>
                    <div v-if="groups.length === 0" class="rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">当前项目还没有视觉资料。请从角色原始档案页创建。</div>
                    <div v-for="group in groups" :key="group.groupId" class="mb-1">
                        <div class="flex items-center gap-1">
                            <button class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-[var(--text-main)] hover:bg-[var(--bg-hover)]" @click="toggleGroup(group.groupId)">
                                <span :class="groupExpanded(group.groupId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-4 w-4 shrink-0"></span>
                                <span class="i-lucide-folder h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                <span class="min-w-0 flex-1 truncate">{{ group.name }}</span>
                                <span v-if="group.enabled" class="i-lucide-badge-check h-3.5 w-3.5 text-[var(--success-text)]" title="当前启用"></span>
                                <span class="text-[11px] text-[var(--text-muted)]">{{ group.characters.length }}</span>
                            </button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" title="重命名分组" :disabled="saving" @click="void renameGroup(group)"><span class="i-lucide-pencil h-3.5 w-3.5"></span></button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40" title="上移分组" :disabled="saving || group.sortOrder === 0" @click="void moveGroup(group, -1)"><span class="i-lucide-chevron-up h-3.5 w-3.5"></span></button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40" title="下移分组" :disabled="saving || group.sortOrder >= groups.length - 1" @click="void moveGroup(group, 1)"><span class="i-lucide-chevron-down h-3.5 w-3.5"></span></button>
                            <button v-if="group.groupId !== 'default'" class="h-7 w-7 rounded text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-40" title="删除空分组" :disabled="saving || group.characterCount > 0" @click="void deleteGroup(group)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                        </div>
                        <div v-if="groupExpanded(group.groupId)" class="ml-4 border-l border-[var(--border-color)] pl-2">
                            <div v-for="item in group.characters" :key="item.characterId" class="mb-1">
                                <button class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="toggleCharacter(group.groupId, item.characterId)">
                                    <span :class="characterExpanded(group.groupId, item.characterId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0"></span>
                                    <span class="i-lucide-user-round h-3.5 w-3.5 shrink-0"></span>
                                    <span class="min-w-0 flex-1 truncate">{{ item.characterId }}</span>
                                    <span class="text-[11px] text-[var(--text-muted)]">{{ item.files.length }}</span>
                                </button>
                                <div v-if="characterExpanded(group.groupId, item.characterId)" class="ml-4 border-l border-[var(--border-color)] pl-2">
                                    <button v-for="file in item.files" :key="file.visualId" class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]" :class="activeVisualId === file.visualId && activeCharacterId === item.characterId && activeGroupId === group.groupId ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'" @click="void selectVisual(group.groupId, item.characterId, file.visualId)">
                                        <span class="i-lucide-file-json h-3.5 w-3.5 shrink-0"></span>
                                        <span class="min-w-0 flex-1 truncate" :title="file.fileName">{{ file.fileName }}</span>
                                        <span v-if="file.active" class="i-lucide-badge-check h-3.5 w-3.5 shrink-0 text-[var(--success-text)]" title="当前使用"></span>
                                        <span v-if="file.invalid" class="i-lucide-triangle-alert h-3.5 w-3.5 shrink-0 text-[var(--warning-text)]" title="JSON 无法解析"></span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                <section class="border-t border-[var(--border-color)] pt-3">
                    <h4 class="mb-2 text-[13px] font-semibold text-[var(--text-main)]">新建分组</h4>
                    <div class="grid gap-2">
                        <input v-model="newGroupId" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" placeholder="分组 ID，例如 story-late" />
                        <input v-model="newGroupName" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" placeholder="显示名称，例如 故事后期" />
                        <button class="h-8 rounded-md border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving" @click="createGroup">创建分组</button>
                    </div>
                </section>
            </aside>

            <main class="min-w-0 flex-1 overflow-y-auto p-4">
                <div v-if="!activeVisualId && !activeCharacterId" class="flex min-h-72 items-center justify-center rounded-md border border-dashed border-[var(--border-color)] p-6 text-center text-[13px] text-[var(--text-muted)]">请从左侧选择一份 JSON 视觉资料，或从角色原始档案页打开一个角色以创建首份视觉资料。</div>
                <section v-else-if="!activeVisualId" class="rounded-md border border-dashed border-[var(--border-color)] p-5">
                    <h3 class="text-[18px] font-semibold text-[var(--text-main)]">创建首份视觉资料</h3>
                    <p class="mt-1 text-[13px] text-[var(--text-muted)]">{{ activeCharacterId }} · {{ activeGroup?.name || "默认分组" }}。LLM 只生成草稿，确认“另存为新设计”后才会创建 visual.json。</p>
                    <div class="mt-4 grid gap-3 md:grid-cols-2">
                        <textarea v-model="characterPage" rows="8" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" placeholder="角色原始 Markdown" />
                        <textarea v-model="userRequirement" rows="8" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" placeholder="本次设计要求，例如：银发、红瞳、故事后期礼服" />
                    </div>
                    <button class="mt-4 h-9 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="void generateVisual">生成首份设计草稿</button>
                </section>
                <template v-else>
                    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p class="text-[12px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{{ activeGroup?.name }}</p>
                            <h3 class="mt-1 text-[20px] font-semibold text-[var(--text-main)]">{{ activeCharacterId }}</h3>
                            <p class="mt-1 text-[13px] text-[var(--text-secondary)]">{{ selectedFile?.fileName }} · {{ selectedFile?.active ? "当前生效" : "仅编辑" }}</p>
                        </div>
                        <span v-if="dirty" class="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[12px] text-[var(--warning-text)]">有未保存修改</span>
                    </div>
                    <nav class="mb-4 flex flex-wrap gap-1 border-b border-[var(--border-color)]">
                        <button v-for="section in characterWorkbenchSections" :key="section.id" class="inline-flex h-9 items-center gap-2 border-b-2 px-3 text-[14px]" :class="subTab === section.id ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'" @click="subTab = section.id">
                            <span :class="[section.icon, 'h-4 w-4']"></span>{{ section.label === "当前启用角色" ? "当前启用角色分组" : section.label }}
                        </button>
                    </nav>

                    <template v-if="subTab === 'character'">
                        <section class="border-b border-[var(--border-color)] pb-5">
                            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                                <div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色详情</h4><p class="mt-1 text-[13px] text-[var(--text-muted)]">当前 JSON 的视觉字段；角色名和触发词保持逻辑角色身份。</p></div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <select v-model="targetGroupId" class="h-8 max-w-44 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" :disabled="saving || groups.length < 2">
                                        <option value="">选择目标分组</option>
                                        <option v-for="group in groups" :key="group.groupId" :value="group.groupId" :disabled="group.groupId === activeGroupId">{{ group.name }}</option>
                                    </select>
                                    <button class="h-8 rounded-md border border-[var(--border-color)] px-2.5 text-[12px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving || !targetGroupId || groups.length < 2" @click="void copyVisualToGroup">加入分组</button>
                                    <button class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="generateVisual"><span class="i-lucide-sparkles h-3.5 w-3.5"></span>生成修改预览</button>
                                </div>
                            </div>
                            <div class="space-y-5">
                                <section v-for="fieldGroup in characterDetailFieldGroups" :key="fieldGroup.id">
                                    <div class="mb-2 flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)]"></span><h5 class="text-[14px] font-medium text-[var(--text-main)]">{{ fieldGroup.title }}</h5></div>
                                    <div class="grid gap-3 md:grid-cols-2">
                                        <label v-for="field in fieldGroup.fields" :key="field" class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]" :class="field === 'negativePrompt' ? 'md:col-span-2' : ''">
                                            {{ characterDetailFieldLabels[field] }}
                                            <textarea v-model="character[field]" :rows="field === 'negativePrompt' ? 4 : 2" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] leading-5 text-[var(--text-main)]" @input="dirty = true" />
                                        </label>
                                    </div>
                                </section>
                            </div>
                        </section>
                        <section class="border-b border-[var(--border-color)] py-5">
                            <h4 class="text-[16px] font-semibold text-[var(--text-main)]">LLM 修改要求</h4>
                            <p class="mt-1 text-[13px] text-[var(--text-muted)]">LLM 只返回草稿；确认覆盖、另存或取消前不会修改当前 JSON。</p>
                            <div class="mt-3 grid gap-3 md:grid-cols-2">
                                <textarea v-model="userRequirement" rows="3" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" placeholder="例如：改成故事后期的黑色礼服，保留银发和红瞳" />
                                <textarea v-model="characterPage" rows="3" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" placeholder="角色原始 Markdown（从角色档案页进入时自动带入）" />
                            </div>
                        </section>
                    </template>

                    <template v-else-if="subTab === 'outfit'">
                        <div class="grid min-h-96 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                            <section class="border-r border-[var(--border-color)] pr-4">
                                <div class="mb-3 flex items-center justify-between"><div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">服装详情</h4><p class="mt-1 text-[12px] text-[var(--text-muted)]">服装属于当前 JSON 视觉版本。</p></div><button class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)]" title="新增服装" @click="addOutfit"><span class="i-lucide-plus h-4 w-4"></span></button></div>
                                <div v-if="outfits.length" class="space-y-1"><button v-for="(outfit, index) in outfits" :key="index" class="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" :class="activeOutfitIndex === index ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : ''" @click="activeOutfitIndex = index"><span class="min-w-0 truncate">{{ outfit.cnName || outfit.enName || `服装 ${index + 1}` }}</span><span class="text-[11px] opacity-70">{{ index + 1 }}</span></button></div>
                                <p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">还没有服装。</p>
                                <button v-if="activeOutfit" class="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--danger-border)] text-[13px] text-[var(--danger-text)]" @click="removeOutfit(activeOutfitIndex)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span>删除当前服装</button>
                            </section>
                            <section v-if="activeOutfit" class="space-y-4"><div class="flex items-center justify-between"><div><h5 class="text-[15px] font-semibold text-[var(--text-main)]">{{ outfitDraft.cnName || outfitDraft.enName || "未命名服装" }}</h5><p class="mt-1 text-[12px] text-[var(--text-muted)]">编辑后点击页面顶部保存。</p></div><button class="h-8 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)]" @click="applyOutfitDraft">应用服装修改</button></div><div class="grid gap-3 md:grid-cols-2"><label v-for="field in outfitDetailFields" :key="field.key" class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">{{ field.label }}<textarea v-model="outfitDraft[field.key]" rows="3" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" /></label></div></section>
                            <section v-else class="flex min-h-72 items-center justify-center rounded-md border border-dashed border-[var(--border-color)] p-6 text-[13px] text-[var(--text-muted)]">选择或新增服装后编辑详情。</section>
                        </div>
                    </template>

                    <template v-else-if="subTab === 'enabled'">
                        <section>
                            <div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">当前启用角色分组</h4><p class="mt-1 text-[13px] text-[var(--text-muted)]">勾选的分组参与正文自动角色扫描；优先级按分组排序。</p></div><span v-if="hasConflict" class="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[12px] text-[var(--warning-text)]">存在跨分组角色覆盖</span></div>
                            <div class="space-y-2"><div v-for="group in groups" :key="group.groupId" class="flex items-center gap-3 rounded-md border border-[var(--border-color)] p-3"><input type="checkbox" :checked="group.enabled" class="accent-[var(--accent-bg)]" :disabled="saving" @change="void toggleGroupEnabled(group)" /><span class="i-lucide-folder h-4 w-4 text-[var(--accent-text)]"></span><span class="min-w-0 flex-1"><span class="block text-[14px] text-[var(--text-main)]">{{ group.name }}</span><span class="text-[12px] text-[var(--text-muted)]">{{ group.characters.length }} 个角色 · 优先级 {{ group.sortOrder + 1 }}</span></span><button class="h-7 rounded-md border border-[var(--border-color)] px-2 text-[12px] text-[var(--text-secondary)]" :disabled="saving" @click="void enableOnly(group)">仅启用此组</button></div></div>
                            <div class="mt-5"><h5 class="mb-2 text-[14px] font-semibold text-[var(--text-main)]">生效预览</h5><div v-if="effectiveCharacters.length" class="grid gap-2 md:grid-cols-2"><button v-for="item in effectiveCharacters" :key="item.characterId" class="flex items-center justify-between rounded-md border border-[var(--border-color)] p-3 text-left hover:bg-[var(--bg-hover)]" @click="void selectVisual(item.groupId, item.characterId, item.file.visualId)"><span class="min-w-0"><span class="block truncate text-[13px] text-[var(--text-main)]">{{ item.characterId }}</span><span class="mt-1 block truncate text-[11px] text-[var(--text-muted)]">{{ item.groupName }} · {{ item.file.fileName }}</span></span><span class="i-lucide-arrow-up-right h-4 w-4 text-[var(--text-muted)]"></span></button></div><p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-4 text-[13px] text-[var(--text-muted)]">没有启用分组，正文将只生成场景内容。</p></div>
                        </section>
                    </template>

                    <template v-else-if="subTab === 'photo'">
                        <section class="space-y-5"><div class="flex flex-wrap items-end justify-between gap-3"><div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色照片</h4><p class="mt-1 text-[13px] text-[var(--text-muted)]">照片归属于当前视觉 JSON。</p></div><div class="flex gap-2"><button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" @click="void generatePhotoPrompt">生成 prompt</button><button class="h-8 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving" @click="void generateAvatar">生成照片</button></div></div><div class="grid gap-3 md:grid-cols-2"><label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">用户要求<input v-model="userRequirement" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]" /></label><label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">当前照片 prompt<textarea v-model="photoPrompt" readonly rows="2" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" /></label></div><ul v-if="photos.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"><li v-for="photo in photos" :key="photo"><div class="aspect-square overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]"><img :src="photoUrl(photo)" class="h-full w-full object-cover" :alt="photo" loading="lazy" /></div><span class="mt-1 block truncate text-[12px] text-[var(--text-muted)]">{{ photo }}</span></li></ul><p v-else class="text-[13px] text-[var(--text-muted)]">当前视觉资料还没有照片。</p></section>
                    </template>
                </template>
            </main>
        </div>

        <div v-if="pendingDraft" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <div class="flex items-start justify-between gap-3"><div><h3 class="text-[18px] font-semibold text-[var(--text-main)]">应用角色设计修改</h3><p class="mt-1 text-[13px] text-[var(--text-muted)]">LLM 已返回草稿，确认前不会修改本地 JSON。</p></div><button class="h-8 w-8 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" @click="pendingDraft = null">×</button></div>
                <div class="mt-4 grid gap-3 md:grid-cols-2"><div class="rounded-md border border-[var(--border-color)] p-3"><p class="text-[12px] text-[var(--text-muted)]">当前文件</p><p class="mt-1 truncate text-[14px] text-[var(--text-main)]">{{ pendingDraft.currentFile?.fileName || "尚未创建" }}</p><p class="mt-2 text-[12px] text-[var(--text-muted)]">服装数量：{{ outfits.length }} → {{ pendingDraft.draft.outfits.length }}</p></div><div class="rounded-md border border-[var(--border-color)] p-3"><p class="text-[12px] text-[var(--text-muted)]">候选文件</p><p class="mt-1 text-[14px] text-[var(--text-main)]">覆盖当前，或另存为新设计</p><p class="mt-2 text-[12px] text-[var(--text-muted)]">角色触发词保持当前逻辑角色身份</p></div></div>
                <section class="mt-4 rounded-md border border-[var(--border-color)] p-3">
                    <p class="mb-2 text-[13px] font-medium text-[var(--text-main)]">字段变化（{{ draftChanges.length }} 项）</p>
                    <div v-if="draftChanges.length" class="max-h-56 overflow-y-auto space-y-2">
                        <div v-for="change in draftChanges" :key="change.label" class="grid gap-2 rounded-md bg-[var(--bg-input)] p-2 text-[12px] md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)]">
                            <span class="font-medium text-[var(--text-secondary)]">{{ change.label }}</span>
                            <span class="whitespace-pre-wrap text-[var(--danger-text)]">{{ change.before || "（空）" }}</span>
                            <span class="whitespace-pre-wrap text-[var(--success-text)]">{{ change.after || "（空）" }}</span>
                        </div>
                    </div>
                    <p v-else class="text-[12px] text-[var(--text-muted)]">没有检测到字段变化。</p>
                </section>
                <details class="mt-3 rounded-md border border-[var(--border-color)] p-3"><summary class="cursor-pointer text-[12px] text-[var(--text-muted)]">查看完整 JSON 草稿</summary><pre class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--bg-input)] p-3 text-[12px] text-[var(--text-secondary)]">{{ JSON.stringify(pendingDraft.draft, null, 2) }}</pre></details>
                <div class="mt-4 flex flex-wrap justify-end gap-2"><button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="pendingDraft = null">取消</button><button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving || !activeVisualId" @click="void commitDraft('overwrite')">覆盖当前设计</button><button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="void commitDraft('create_new')">另存为新设计</button></div>
            </div>
        </div>

        <footer v-if="error || loading" class="shrink-0 border-t border-[var(--border-color)] px-4 py-2"><p v-if="error" class="text-[13px] text-[var(--danger-text)]">{{ error }}</p><p v-else class="text-[13px] text-[var(--text-muted)]">加载中...</p></footer>
    </div>
</template>
