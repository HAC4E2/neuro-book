<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {resolveApiErrorMessage, resolveApiErrorStatus} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";
import type {CharacterGenerationContext} from "nbook/app/components/novel-ide/text-to-image/character-context";
import {
    characterDetailFieldGroups,
    characterDetailFieldLabels,
    characterWorkbenchSections,
    type CharacterFieldKey,
    type CharacterWorkbenchSectionId,
    outfitDetailFields,
} from "nbook/app/components/novel-ide/text-to-image/character-workbench";
import {useUnsavedGuard, type UnsavedGuardSaveStatus} from "nbook/app/components/novel-ide/text-to-image/leave-guard";

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
/** 当前页面状态实际绑定并加载的 Project 根；外部 prop 变化必须经过离开保护后才提交。 */
const loadedProjectRoot = ref("");
type CharacterAction = "save_visual" | "create_group" | "delete_group" | "delete_visual" | "move_to_group" | "update_activation" | "generate_design" | "generate_modify" | "commit_overwrite" | "commit_create_new" | "generate_photo_prompt" | "generate_photo" | null;
const activeAction = ref<CharacterAction>(null);
const notification = useNotification();
const activeActionLabels: Record<Exclude<CharacterAction, null>, string> = {
    save_visual: "正在保存视觉资料…",
    create_group: "正在创建分组…",
    delete_group: "正在把视觉资料迁移到默认分组并删除来源分组…",
    delete_visual: "正在删除视觉资料…",
    move_to_group: "正在移动到目标分组…",
    update_activation: "正在更新启用分组…",
    generate_design: "正在发送首份设计请求，等待 LLM 回复…",
    generate_modify: "正在生成修改预览，等待 LLM 回复…",
    commit_overwrite: "正在覆盖当前视觉资料…",
    commit_create_new: "正在创建新的视觉资料版本…",
    generate_photo_prompt: "正在生成照片 prompt，等待 LLM 回复…",
    generate_photo: "正在请求 NovelAI 生成照片…",
};
const activeActionLabel = computed(() => (activeAction.value ? activeActionLabels[activeAction.value] : ""));
/** 同一面板同一时间只允许一个写操作；返回 false 表示已有动作在途，直接丢弃本次点击。 */
function beginAction(action: Exclude<CharacterAction, null>): boolean {
    if (activeAction.value !== null) return false;
    activeAction.value = action;
    return true;
}
function endAction(): void {
    saving.value = false;
    activeAction.value = null;
}
/** 身份字段与普通视觉字段分别追踪：身份变化走身份保存，视觉变化走当前 JSON 保存。 */
const loadedIdentity = ref<{cnName: string; enName: string; triggerWords: string}>({cnName: "", enName: "", triggerWords: ""});
const loadedCharacter = ref<Record<CharacterFieldKey, string>>({...defaultCharacterFields});
const loadedOutfits = ref<CharacterOutfit[]>([]);
const loadedPhotos = ref<string[]>([]);
const identityDirty = computed(() => (
    character.value.cnName !== loadedIdentity.value.cnName
    || character.value.enName !== loadedIdentity.value.enName
    || character.value.triggerWords !== loadedIdentity.value.triggerWords
));
const visualDirty = computed(() => {
    for (const key of Object.keys(defaultCharacterFields) as CharacterFieldKey[]) {
        if (key === "cnName" || key === "enName" || key === "triggerWords") continue;
        if ((character.value[key] ?? "") !== (loadedCharacter.value[key] ?? "")) return true;
    }
    return JSON.stringify(outfits.value) !== JSON.stringify(loadedOutfits.value)
        || JSON.stringify(photos.value) !== JSON.stringify(loadedPhotos.value);
});
const hasUnsavedChanges = computed(() => identityDirty.value || visualDirty.value);

function snapshotLoaded(): void {
    loadedIdentity.value = {cnName: character.value.cnName, enName: character.value.enName, triggerWords: character.value.triggerWords};
    loadedCharacter.value = {...character.value};
    loadedOutfits.value = outfits.value.map((item) => ({...item}));
    loadedPhotos.value = [...photos.value];
}

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

onMounted(() => {
    loadedProjectRoot.value = props.projectRoot;
    void loadLibrary();
});
watch(() => props.projectRoot, async (next, previous) => {
    if (!previous || next === previous || next === loadedProjectRoot.value) return;
    if (await leaveGuard.guard("切换 Project 会丢失当前未保存修改")) {
        loadedProjectRoot.value = next;
        await loadLibrary();
    } else {
        error.value = "Project 切换已取消；当前页面仍绑定原 Project，重新加载后才能写入新 Project";
    }
});
watch(() => props.initialCharacter, () => void applyInitialCharacter(), {immediate: true});
watch(activeOutfitIndex, syncOutfitDraft, {immediate: true});

async function loadLibrary(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<{groups: CharacterGroup[]}>("/api/text-to-image/character-library", {
            query: {projectRoot: loadedProjectRoot.value},
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
            const current = activeCharacter.value?.files.find((file) => file.visualId === activeVisualId.value)
                ?? activeCharacter.value?.files[0];
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
                projectRoot: loadedProjectRoot.value,
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
        snapshotLoaded();
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

const triggerWordsError = ref("");
/** 触发词规范化预览：输入合法时展示保存后的规范格式。 */
const triggerWordsPreview = computed(() => {
    const raw = character.value.triggerWords ?? "";
    if (triggerWordsError.value) return "";
    const values = raw.split("|").map((item) => item.trim()).filter((item) => item !== "");
    const seen = new Set<string>();
    const unique = values.filter((item) => {
        const key = item.normalize("NFKC").toLocaleLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return unique.join(" | ");
});

function onTriggerWordsInput(): void {
    const raw = character.value.triggerWords ?? "";
    if (raw.includes(",") || raw.includes("，")) {
        triggerWordsError.value = "触发词只能使用 | 分隔";
    } else if (raw.includes("||")) {
        triggerWordsError.value = "触发词不能包含连续空项";
    } else if (raw.trim().startsWith("|") || raw.trim().endsWith("|")) {
        triggerWordsError.value = "触发词首尾不能是 |";
    } else {
        triggerWordsError.value = "";
    }
}

type CharacterIdentitySummary = {
    revision: string;
    groupCount: number;
    fileCount: number;
    identity: {cnName: string; enName: string; triggerWords: string} | null;
    damagedFiles: string[];
};

const identitySummary = ref<CharacterIdentitySummary | null>(null);
const identitySubmitting = ref(false);

async function saveVisual(): Promise<boolean> {
    if (!activeGroupId.value || !activeCharacterId.value || !activeVisualId.value || !selectedFile.value) return false;
    if (triggerWordsError.value) {
        error.value = triggerWordsError.value;
        return false;
    }
    if (identityDirty.value) {
        // 身份变化必须走身份保存：先读取同步范围摘要，再让用户确认。
        if (!beginAction("save_visual")) return false;
        saving.value = true;
        error.value = "";
        try {
            identitySummary.value = await $fetch<CharacterIdentitySummary>("/api/text-to-image/character-library/identity", {
                query: {projectRoot: loadedProjectRoot.value, characterId: activeCharacterId.value},
            });
            return false;
        } catch (cause) {
            error.value = resolveApiErrorMessage(cause, "读取角色身份摘要失败");
            return false;
        } finally {
            endAction();
        }
    }
    if (!beginAction("save_visual")) return false;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual", {
            method: "PUT",
            body: {
                projectRoot: loadedProjectRoot.value,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
                expectedUpdatedAt: selectedFile.value.updatedAt,
                setActive: false,
                visual: buildVisual(),
            },
        });
        snapshotLoaded();
        notification.success("视觉资料已保存");
        await loadLibrary();
        return true;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存视觉资料失败");
        return false;
    } finally {
        endAction();
    }
}

async function confirmIdentitySave(): Promise<void> {
    const summary = identitySummary.value;
    if (!summary || !activeGroupId.value || !activeCharacterId.value || !activeVisualId.value || !selectedFile.value) return;
    if (!beginAction("save_visual")) return;
    identitySubmitting.value = true;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{updatedFileCount: number; groupCount: number}>("/api/text-to-image/character-library/identity", {
            method: "PUT",
            body: {
                projectRoot: loadedProjectRoot.value,
                characterId: activeCharacterId.value,
                identity: {
                    cnName: character.value.cnName,
                    enName: character.value.enName,
                    triggerWords: character.value.triggerWords,
                },
                selectedVisual: {
                    groupId: activeGroupId.value,
                    visualId: activeVisualId.value,
                    expectedUpdatedAt: selectedFile.value.updatedAt,
                    visual: buildVisual(),
                },
                expectedIdentityRevision: summary.revision,
            },
        });
        identitySummary.value = null;
        snapshotLoaded();
        notification.success(`已同步 ${result.groupCount} 个分组的 ${result.updatedFileCount} 份视觉 JSON`);
        await loadLibrary();
        leaveGuard.resolveStagedSave(true);
    } catch (cause) {
        if (resolveApiErrorStatus(cause) === 409) {
            error.value = "身份在保存前发生了变化，请重新保存";
        } else {
            error.value = resolveApiErrorMessage(cause, "保存角色身份失败");
        }
        identitySummary.value = null;
        leaveGuard.resolveStagedSave(false);
    } finally {
        identitySubmitting.value = false;
        endAction();
    }
}

async function renameVisual(): Promise<void> {
    if (!selectedFile.value) return;
    const nextName = window.prompt("请输入新的 JSON 文件名", selectedFile.value.fileName);
    if (!nextName || nextName.trim() === selectedFile.value.fileName) return;
    if (!beginAction("save_visual")) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual.rename", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
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
        endAction();
    }
}

async function deleteVisual(): Promise<void> {
    if (!selectedFile.value || visualFiles.value.length <= 1 || selectedFile.value.active) return;
    if (!confirm(`确定删除“${selectedFile.value.fileName}”？照片登记也会一并移除。`)) return;
    if (!beginAction("delete_visual")) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual.delete", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
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
        endAction();
    }
}

async function setActiveVisual(): Promise<void> {
    if (!activeVisualId.value) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/visual.active", {
            method: "PUT",
            body: {
                projectRoot: loadedProjectRoot.value,
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

type MovePreview = {
    revision: string;
    source: {groupId: string; characterId: string; visualId: string};
    targetGroupId: string;
    sourceWillLoseCharacter: boolean;
    sourceNeedsActiveFallback: boolean;
    targetCharacterExists: boolean;
    equivalentTargetRef: {groupId: string; characterId: string; visualId: string} | null;
    equivalentTargetConflict: boolean;
    fileNameConflict: boolean;
    visualIdConflict: boolean;
    managedReferenceCount: number;
    sourceActive: boolean;
    sourceFileCount: number;
};

type FrozenMove = {
    projectRoot: string;
    sourceGroupId: string;
    sourceCharacterId: string;
    sourceVisualId: string;
    expectedUpdatedAt: string;
    targetGroupId: string;
};

const movePreview = ref<MovePreview | null>(null);
const moveFrozen = ref<FrozenMove | null>(null);
const moveSubmitting = ref(false);

async function moveVisualToGroup(): Promise<void> {
    if (!await confirmDiscardForRequest()) return;
    if (!selectedFile.value || !activeGroupId.value || !activeCharacterId.value || !activeVisualId.value || !targetGroupId.value) {
        error.value = "请选择当前视觉资料和目标分组";
        return;
    }
    if (targetGroupId.value === activeGroupId.value) {
        error.value = "目标分组必须与当前分组不同";
        return;
    }
    if (!beginAction("move_to_group")) return;
    saving.value = true;
    error.value = "";
    // 提交时冻结来源与目标；用户随后切换选择不能改变已发请求。
    const frozen: FrozenMove = {
        projectRoot: loadedProjectRoot.value,
        sourceGroupId: activeGroupId.value,
        sourceCharacterId: activeCharacterId.value,
        sourceVisualId: activeVisualId.value,
        expectedUpdatedAt: selectedFile.value.updatedAt,
        targetGroupId: targetGroupId.value,
    };
    try {
        const preview = await $fetch<MovePreview>("/api/text-to-image/character-library/visual.move-preview", {
            query: {
                projectRoot: loadedProjectRoot.value,
                sourceGroupId: frozen.sourceGroupId,
                sourceCharacterId: frozen.sourceCharacterId,
                sourceVisualId: frozen.sourceVisualId,
                targetGroupId: frozen.targetGroupId,
            },
        });
        if (preview.equivalentTargetConflict || preview.equivalentTargetRef || preview.fileNameConflict || preview.visualIdConflict) {
            // 存在冲突或等价合并时展示最终行为，让用户确认。
            movePreview.value = preview;
            moveFrozen.value = frozen;
            endAction();
            saving.value = false;
            return;
        }
        endAction();
        saving.value = false;
        await submitMove(frozen, preview.revision);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取移动影响摘要失败");
        endAction();
        saving.value = false;
    }
}

async function submitMove(frozen: FrozenMove, previewRevision: string): Promise<void> {
    if (!beginAction("move_to_group")) return;
    moveSubmitting.value = true;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{mode: "moved" | "merged-equivalent"; ref: {groupId: string; characterId: string; visualId: string}}>("/api/text-to-image/character-library/visual.move", {
            method: "POST",
            body: {...frozen, expectedPreviewRevision: previewRevision},
        });
        movePreview.value = null;
        moveFrozen.value = null;
        activeGroupId.value = result.ref.groupId;
        activeCharacterId.value = result.ref.characterId;
        activeVisualId.value = result.ref.visualId;
        expandedGroupIds.value = [...new Set([...expandedGroupIds.value, result.ref.groupId])];
        expandedCharacterKeys.value = [...new Set([...expandedCharacterKeys.value, `${result.ref.groupId}\u0000${result.ref.characterId}`])];
        notification.success(result.mode === "merged-equivalent" ? "已合并目标分组中的相同资料" : "已移动到目标分组，来源不再保留这一份资料");
        await loadLibrary();
    } catch (cause) {
        if (resolveApiErrorStatus(cause) === 409) {
            error.value = "分组数据已变化，请重新查看移动影响后再确认";
        } else {
            error.value = resolveApiErrorMessage(cause, "移动视觉资料失败");
        }
        movePreview.value = null;
        moveFrozen.value = null;
    } finally {
        moveSubmitting.value = false;
        endAction();
    }
}

function closeMovePreview(): void {
    movePreview.value = null;
    moveFrozen.value = null;
}

async function createGroup(): Promise<void> {
    const name = newGroupName.value.trim();
    if (!name) {
        error.value = "请输入分组名称";
        return;
    }
    if (!beginAction("create_group")) return;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{group: CharacterGroup}>("/api/text-to-image/character-library/groups", {
            method: "POST",
            body: {projectRoot: loadedProjectRoot.value, name},
        });
        newGroupName.value = "";
        expandedGroupIds.value = [...new Set([...expandedGroupIds.value, result.group.groupId])];
        targetGroupId.value = result.group.groupId;
        notification.success(`已创建分组“${result.group.name}”`);
        await loadLibrary();
    } catch (cause) {
        // 同名冲突时保留输入内容，由 error 就地提示。
        error.value = resolveApiErrorMessage(cause, "创建角色分组失败");
    } finally {
        endAction();
    }
}

async function renameGroup(group: CharacterGroup): Promise<void> {
    const name = window.prompt("请输入分组显示名称", group.name)?.trim();
    if (!name || name === group.name) return;
    if (!beginAction("create_group")) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-library/groups", {
            method: "PUT",
            body: {projectRoot: loadedProjectRoot.value, groupId: group.groupId, name},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "重命名角色分组失败");
    } finally {
        endAction();
    }
}

type DeleteGroupPreview = {
    groupId: string;
    revision: string;
    characterCount: number;
    visualCount: number;
    invalidFileCount: number;
    fileNameConflictCount: number;
    visualIdConflictCount: number;
    managedReferenceCount: number;
    defaultEnabled: boolean;
};

type DeleteGroupRefMapping = {
    old: {groupId: string; characterId: string; visualId: string};
    next: {groupId: string; characterId: string; visualId: string};
};

const deleteTargetGroup = ref<CharacterGroup | null>(null);
const deletePreview = ref<DeleteGroupPreview | null>(null);
const deleteSubmitting = ref(false);

async function openDeleteGroupPreview(group: CharacterGroup): Promise<void> {
    if (group.groupId === "default") return;
    if (!beginAction("delete_group")) return;
    saving.value = true;
    error.value = "";
    try {
        deletePreview.value = await $fetch<DeleteGroupPreview>("/api/text-to-image/character-library/groups.delete-preview", {
            query: {projectRoot: loadedProjectRoot.value, groupId: group.groupId},
        });
        deleteTargetGroup.value = group;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取分组删除摘要失败");
    } finally {
        endAction();
    }
}

function closeDeleteGroupPreview(): void {
    deleteTargetGroup.value = null;
    deletePreview.value = null;
    deleteSubmitting.value = false;
}

async function confirmDeleteGroup(): Promise<void> {
    const target = deleteTargetGroup.value;
    const preview = deletePreview.value;
    if (!target || !preview || deleteSubmitting.value) return;
    deleteSubmitting.value = true;
    saving.value = true;
    activeAction.value = "delete_group";
    error.value = "";
    let revisionExpired = false;
    try {
        const result = await $fetch<{moved: {characterCount: number; visualCount: number}; refMap: DeleteGroupRefMapping[]}>("/api/text-to-image/character-library/groups", {
            method: "DELETE",
            body: {projectRoot: loadedProjectRoot.value, groupId: target.groupId, expectedRevision: preview.revision},
        });
        const currentMapping = result.refMap.find((mapping) => mapping.old.visualId === activeVisualId.value);
        if (currentMapping) {
            activeGroupId.value = currentMapping.next.groupId;
            activeCharacterId.value = currentMapping.next.characterId;
            activeVisualId.value = currentMapping.next.visualId;
        } else if (activeGroupId.value === target.groupId) {
            activeGroupId.value = "default";
        }
        expandedGroupIds.value = [...new Set([...expandedGroupIds.value, "default"])];
        closeDeleteGroupPreview();
        notification.success(`已删除分组“${target.name}”：${result.moved.characterCount} 个角色的 ${result.moved.visualCount} 份视觉资料已移动到默认分组`);
        await loadLibrary();
    } catch (cause) {
        if (resolveApiErrorStatus(cause) === 409) {
            // 预检后数据已变化：旧确认不能继续提交，保留 Dialog 并重新拉取摘要。
            revisionExpired = true;
            deletePreview.value = null;
            error.value = "分组数据已变化，请重新查看影响摘要后再确认";
        } else {
            error.value = resolveApiErrorMessage(cause, "删除角色分组失败");
            closeDeleteGroupPreview();
        }
    } finally {
        saving.value = false;
        activeAction.value = null;
        deleteSubmitting.value = false;
    }
    if (revisionExpired) await openDeleteGroupPreview(target);
}

async function moveGroup(group: CharacterGroup, direction: -1 | 1): Promise<void> {
    const ordered = [...groups.value].sort((left, right) => left.sortOrder - right.sortOrder);
    const index = ordered.findIndex((item) => item.groupId === group.groupId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    if (!beginAction("create_group")) return;
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-library/groups.reorder", {
            method: "PUT",
            body: {projectRoot: loadedProjectRoot.value, orderedGroupIds: ordered.map((item) => item.groupId)},
        });
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "调整角色分组顺序失败");
    } finally {
        endAction();
    }
}

const updatingGroupId = ref("");

async function toggleGroupEnabled(group: CharacterGroup): Promise<void> {
    if (!beginAction("update_activation")) return;
    updatingGroupId.value = group.groupId;
    saving.value = true;
    error.value = "";
    try {
        const nextEnabledGroupIds = group.enabled
            ? enabledGroupIds.value.filter((id) => id !== group.groupId)
            : [...enabledGroupIds.value, group.groupId];
        const result = await $fetch<{groups: Array<{groupId: string; enabled: boolean}>}>("/api/text-to-image/character-library.activation", {
            method: "PUT",
            body: {projectRoot: loadedProjectRoot.value, enabledGroupIds: nextEnabledGroupIds},
        });
        applyEnabledGroupsFromResponse(result.groups);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "更新启用分组失败");
        notification.error("更新启用分组失败，已保持服务端原状态");
    } finally {
        updatingGroupId.value = "";
        endAction();
    }
}

async function enableOnly(group: CharacterGroup): Promise<void> {
    if (!beginAction("update_activation")) return;
    updatingGroupId.value = group.groupId;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{groups: Array<{groupId: string; enabled: boolean}>}>("/api/text-to-image/character-library.activation", {
            method: "PUT",
            body: {projectRoot: loadedProjectRoot.value, enabledGroupIds: [group.groupId]},
        });
        applyEnabledGroupsFromResponse(result.groups);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "更新启用分组失败");
        notification.error("更新启用分组失败，已保持服务端原状态");
    } finally {
        updatingGroupId.value = "";
        endAction();
    }
}

/** 只以 API 返回状态更新启用标识，不用本地猜测；失败时不改任何本地状态。 */
function applyEnabledGroupsFromResponse(serverGroups: Array<{groupId: string; enabled: boolean}>): void {
    const enabled = new Map(serverGroups.map((group) => [group.groupId, group.enabled]));
    groups.value = groups.value.map((group) => ({...group, enabled: enabled.get(group.groupId) ?? group.enabled}));
}

async function generateVisual(): Promise<void> {
    if (!await confirmDiscardForRequest()) return;
    if (!activeCharacterId.value) {
        error.value = "请先选择角色视觉资料";
        return;
    }
    if (!characterPage.value.trim() && !userRequirement.value.trim()) {
        error.value = "请提供角色原始档案或本次修改要求";
        return;
    }
    const isModify = Boolean(activeVisualId.value);
    if (!beginAction(isModify ? "generate_modify" : "generate_design")) return;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{visual?: CharacterVisual; draft?: CharacterVisual; current: CharacterVisual | null; currentFile: VisualFileInfo | null; baseRevision: string | null}>(isModify
            ? "/api/text-to-image/character-visual.modify-preview"
            : "/api/text-to-image/character-visual.generate", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
                groupId: activeGroupId.value || "default",
                characterId: activeCharacterId.value,
                ...(isModify ? {
                    visualId: activeVisualId.value,
                    selectedOutfitIndex: activeOutfitIndex.value >= 0 ? activeOutfitIndex.value : null,
                } : {}),
                characterPage: characterPage.value,
                userRequirement: userRequirement.value,
            },
        });
        pendingDraft.value = {
            draft: result.draft ?? result.visual!,
            current: result.current,
            currentFile: result.currentFile,
            baseRevision: result.baseRevision,
        };
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色视觉修改草稿失败");
    } finally {
        endAction();
    }
}

async function commitDraft(action: "overwrite" | "create_new"): Promise<void> {
    const pending = pendingDraft.value;
    if (!pending) return;
    if (action === "overwrite" && !activeVisualId.value) {
        error.value = "当前没有可覆盖的视觉资料，请选择另存为新设计";
        return;
    }
    if (!beginAction(action === "overwrite" ? "commit_overwrite" : "commit_create_new")) return;
    saving.value = true;
    error.value = "";
    try {
        const result = await $fetch<{ref: {visualId: string}}>("/api/text-to-image/character-visual.modify-commit", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
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
        notification.success(action === "overwrite" ? "已覆盖当前视觉设计" : "已创建新的视觉设计版本");
        await loadLibrary();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "提交视觉资料修改失败");
    } finally {
        endAction();
    }
}

async function generatePhotoPrompt(): Promise<void> {
    if (!await confirmDiscardForRequest()) return;
    if (!activeVisualId.value || !activeCharacterId.value || !activeGroupId.value) {
        error.value = "请先选择角色视觉资料";
        return;
    }
    if (!beginAction("generate_photo_prompt")) return;
    saving.value = true;
    try {
        const result = await $fetch<{prompt: string}>("/api/text-to-image/character-photo.generate-prompt", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
                groupId: activeGroupId.value,
                characterId: activeCharacterId.value,
                visualId: activeVisualId.value,
                selectedOutfitIndex: activeOutfitIndex.value >= 0 ? activeOutfitIndex.value : null,
                userRequirement: userRequirement.value,
            },
        });
        photoPrompt.value = result.prompt;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成照片 prompt 失败");
    } finally {
        endAction();
    }
}

async function generateAvatar(): Promise<void> {
    if (!await confirmDiscardForRequest()) return;
    if (!activeVisualId.value) return;
    if (!beginAction("generate_photo")) return;
    saving.value = true;
    try {
        await $fetch("/api/text-to-image/character-photo.generate", {
            method: "POST",
            body: {
                projectRoot: loadedProjectRoot.value,
                groupId: activeGroupId.value,
                visualId: activeVisualId.value,
                characterId: activeCharacterId.value,
                selectedOutfitIndex: activeOutfitIndex.value >= 0 ? activeOutfitIndex.value : null,
                userRequirement: userRequirement.value,
            },
        });
        await loadVisual();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色照片失败");
    } finally {
        endAction();
    }
}

function addOutfit(): void {
    outfits.value.push({...defaultOutfit});
    activeOutfitIndex.value = outfits.value.length - 1;
}

function removeOutfit(index: number): void {
    outfits.value.splice(index, 1);
    activeOutfitIndex.value = Math.min(activeOutfitIndex.value, outfits.value.length - 1);
    syncOutfitDraft();
}

function photoUrl(photo: string): string {
    return `/api/text-to-image/assets/by-path/content?projectRoot=${encodeURIComponent(loadedProjectRoot.value)}&relativePath=${encodeURIComponent(photo)}`;
}

async function confirmDiscardForRequest(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true;
    if (!confirm("当前视觉资料有未保存修改，是否放弃这些修改？")) return false;
    await loadVisual();
    return true;
}

async function confirmDiscardIfDirty(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true;
    return confirm("当前视觉资料有未保存修改，是否放弃这些修改？");
}

/** 保存身份/视觉并返回是否成功；供离开保护复用。 */
async function saveForGuard(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true;
    return saveVisual();
}

/**
 * 离开保护的分阶段保存：身份变化会先打开身份同步确认，确认成功后才算保存完成；
 * 在确认完成前保护保持 pending，原始关闭/切页/切 Project 动作不会提前继续。
 */
async function saveForGuardStaged(): Promise<UnsavedGuardSaveStatus> {
    if (!hasUnsavedChanges.value) return "saved";
    if (identityDirty.value) {
        const saved = await saveVisual();
        return identitySummary.value ? "pending-confirmation" : (saved ? "saved" : "failed");
    }
    return await saveVisual() ? "saved" : "failed";
}

function discardForGuard(): void {
    void loadVisual();
}

const leaveGuard = useUnsavedGuard({
    hasUnsavedChanges: () => hasUnsavedChanges.value,
    save: saveForGuard,
    saveStaged: saveForGuardStaged,
    discard: discardForGuard,
});

defineExpose({
    guard: leaveGuard.guard,
});
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
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving || !activeVisualId || !hasUnsavedChanges" @click="saveVisual">
                    <span class="i-lucide-save h-4 w-4"></span>保存
                </button>
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving || !selectedFile" @click="renameVisual">
                    <span class="i-lucide-file-pen h-4 w-4"></span>重命名 JSON
                </button>
                <button class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger-border)] px-3 text-[14px] text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-50" :disabled="saving || !selectedFile || selectedFile.active || visualFiles.length <= 1" @click="deleteVisual">
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
                                <span v-if="group.enabled" class="shrink-0 rounded bg-[var(--accent-bg)] px-1.5 py-0.5 text-[11px] text-[var(--accent-text)]">启用</span>
                                <span v-if="group.enabled" class="i-lucide-badge-check h-3.5 w-3.5 shrink-0 text-[var(--success-text)]" title="当前启用"></span>
                                <span class="text-[11px] text-[var(--text-muted)]">{{ group.characterCount }}</span>
                            </button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" title="重命名分组" :disabled="saving" @click="renameGroup(group)"><span class="i-lucide-pencil h-3.5 w-3.5"></span></button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40" title="上移分组" :disabled="saving || group.sortOrder === 0" @click="moveGroup(group, -1)"><span class="i-lucide-chevron-up h-3.5 w-3.5"></span></button>
                            <button class="h-7 w-7 rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-40" title="下移分组" :disabled="saving || group.sortOrder >= groups.length - 1" @click="moveGroup(group, 1)"><span class="i-lucide-chevron-down h-3.5 w-3.5"></span></button>
                            <button v-if="group.groupId !== 'default'" class="h-7 w-7 rounded text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-40" title="删除分组（视觉资料移动到默认分组）" :disabled="saving" @click="openDeleteGroupPreview(group)"><span class="i-lucide-trash-2 h-3.5 w-3.5"></span></button>
                        </div>
                        <div v-if="groupExpanded(group.groupId)" class="ml-4 border-l border-[var(--border-color)] pl-2">
                            <div v-if="group.characters.length === 0" class="rounded-md px-2 py-1.5 text-[12px] text-[var(--text-muted)]">暂无视觉资料</div>
                            <div v-for="item in group.characters" :key="item.characterId" class="mb-1">
                                <button class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="toggleCharacter(group.groupId, item.characterId)">
                                    <span :class="characterExpanded(group.groupId, item.characterId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="h-3.5 w-3.5 shrink-0"></span>
                                    <span class="i-lucide-user-round h-3.5 w-3.5 shrink-0"></span>
                                    <span class="min-w-0 flex-1 truncate">{{ item.characterId }}</span>
                                    <span class="text-[11px] text-[var(--text-muted)]">{{ item.files.length }}</span>
                                </button>
                                <div v-if="characterExpanded(group.groupId, item.characterId)" class="ml-4 border-l border-[var(--border-color)] pl-2">
                                    <button v-for="file in item.files" :key="file.visualId" class="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-[var(--bg-hover)]" :class="activeVisualId === file.visualId && activeCharacterId === item.characterId && activeGroupId === group.groupId ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'" @click="selectVisual(group.groupId, item.characterId, file.visualId)">
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
                        <input v-model="newGroupName" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[12px] text-[var(--text-main)]" placeholder="分组名称，例如 故事后期" />
                        <button class="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border-color)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50" :disabled="saving" @click="createGroup"><span v-if="activeAction === 'create_group'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>{{ activeAction === 'create_group' ? '创建中…' : '创建分组' }}</button>
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
                    <button class="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="generateVisual"><span v-if="activeAction === 'generate_design'" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ activeAction === 'generate_design' ? '正在等待 LLM 回复…' : '生成首份设计草稿' }}</button>
                </section>
                <template v-else>
                    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p class="text-[12px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{{ activeGroup?.name }}</p>
                            <h3 class="mt-1 text-[20px] font-semibold text-[var(--text-main)]">{{ activeCharacterId }}</h3>
                            <p class="mt-1 text-[13px] text-[var(--text-secondary)]">{{ selectedFile?.fileName }} · {{ selectedFile?.active ? "当前生效" : "仅编辑" }}</p>
                        </div>
                        <span v-if="hasUnsavedChanges" class="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[12px] text-[var(--warning-text)]">有未保存修改</span>
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
                                    <button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[12px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving || !targetGroupId || groups.length < 2" @click="moveVisualToGroup"><span v-if="activeAction === 'move_to_group'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>{{ activeAction === 'move_to_group' ? '移动中…' : '移动到分组' }}</button>
                                    <button class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="generateVisual"><span v-if="activeAction === 'generate_modify'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span><span v-else class="i-lucide-sparkles h-3.5 w-3.5"></span>{{ activeAction === 'generate_modify' ? '等待 LLM 回复…' : '生成修改预览' }}</button>
                                </div>
                                <p class="w-full text-[12px] text-[var(--text-muted)]">移动到分组：移动当前 JSON；来源不会保留这一份资料，照片和固定发送引用保持有效。</p>
                            </div>
                            <div class="space-y-5">
                                <section v-for="fieldGroup in characterDetailFieldGroups" :key="fieldGroup.id">
                                    <div class="mb-2 flex items-center gap-2"><span class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)]"></span><h5 class="text-[14px] font-medium text-[var(--text-main)]">{{ fieldGroup.title }}</h5></div>
                                    <div class="grid gap-3 md:grid-cols-2">
                                        <label v-for="field in fieldGroup.fields" :key="field" class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]" :class="field === 'negativePrompt' ? 'md:col-span-2' : ''">
                                            {{ characterDetailFieldLabels[field] }}
                                            <textarea v-model="character[field]" :rows="field === 'negativePrompt' ? 4 : 2" class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] leading-5 text-[var(--text-main)]" :class="field === 'triggerWords' && triggerWordsError ? 'border-[var(--danger-border)]' : ''" @input="field === 'triggerWords' ? onTriggerWordsInput() : undefined" />
                                            <span v-if="field === 'triggerWords' && triggerWordsError" class="text-[12px] text-[var(--danger-text)]">{{ triggerWordsError }}</span>
                                            <span v-else-if="field === 'triggerWords'" class="text-[12px] text-[var(--text-muted)]">留空时正文扫描使用角色中英文名；不会自动写入输入框。保存格式：{{ triggerWordsPreview || "（空）" }}</span>
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
                            <div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">当前启用角色分组 <span class="text-[13px] font-normal text-[var(--text-secondary)]">已启用 {{ enabledGroupIds.length }} / {{ groups.length }} 个分组</span></h4><p class="mt-1 text-[13px] text-[var(--text-muted)]">启用的分组参与正文自动角色扫描；优先级按分组排序，同名角色取更高优先级分组的版本。</p></div><span v-if="hasConflict" class="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[12px] text-[var(--warning-text)]">存在跨分组角色覆盖</span></div>
                            <p v-if="groups.length > 0 && enabledGroupIds.length === 0" class="mb-3 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-[13px] text-[var(--warning-text)]">正文不会自动注入角色，只生成场景内容</p>
                            <div class="space-y-2">
                                <button
                                    v-for="group in groups"
                                    :key="group.groupId"
                                    type="button"
                                    role="checkbox"
                                    :aria-checked="group.enabled"
                                    class="flex w-full cursor-pointer items-center gap-3 rounded-md border p-3 text-left"
                                    :class="group.enabled ? 'border-[var(--border-accent)] bg-[var(--accent-bg)]' : 'border-[var(--border-color)] bg-[var(--bg-surface)]'"
                                    :disabled="saving"
                                    @click="toggleGroupEnabled(group)"
                                >
                                    <span class="i-lucide-check h-4 w-4 shrink-0" :class="group.enabled ? 'text-[var(--accent-text)]' : 'opacity-0'"></span>
                                    <span class="i-lucide-folder h-4 w-4 shrink-0 text-[var(--accent-text)]"></span>
                                    <span class="min-w-0 flex-1"><span class="block text-[14px] text-[var(--text-main)]">{{ group.name }}</span><span class="text-[12px] text-[var(--text-muted)]">{{ group.characters.length }} 个角色 · 优先级 {{ group.sortOrder + 1 }}</span></span>
                                    <span v-if="updatingGroupId === group.groupId" class="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--status-info-bg)] px-1.5 py-0.5 text-[12px] text-[var(--status-info)]"><span class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>正在更新…</span>
                                    <span v-else-if="group.enabled" class="shrink-0 rounded bg-[var(--accent-main)] px-1.5 py-0.5 text-[12px] text-[var(--text-inverse)]">已启用</span>
                                    <span v-else class="shrink-0 rounded bg-[var(--bg-input)] px-1.5 py-0.5 text-[12px] text-[var(--text-muted)]">未启用</span>
                                </button>
                            </div>
                            <div class="mt-4 flex flex-wrap gap-2">
                                <button v-for="group in groups" :key="`only-${group.groupId}`" class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-2.5 text-[12px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving || (group.enabled && enabledGroupIds.length === 1)" @click="enableOnly(group)"><span v-if="updatingGroupId === group.groupId" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>{{ group.enabled && enabledGroupIds.length === 1 ? "当前唯一启用" : `仅启用「${group.name}」` }}</button>
                            </div>
                            <div class="mt-5"><h5 class="mb-2 text-[14px] font-semibold text-[var(--text-main)]">生效预览</h5><div v-if="effectiveCharacters.length" class="grid gap-2 md:grid-cols-2"><button v-for="item in effectiveCharacters" :key="item.characterId" class="flex items-center justify-between rounded-md border border-[var(--border-color)] p-3 text-left hover:bg-[var(--bg-hover)]" @click="selectVisual(item.groupId, item.characterId, item.file.visualId)"><span class="min-w-0"><span class="block truncate text-[13px] text-[var(--text-main)]">{{ item.characterId }}</span><span class="mt-1 block truncate text-[11px] text-[var(--text-muted)]">{{ item.groupName }} · {{ item.file.fileName }}</span></span><span class="i-lucide-arrow-up-right h-4 w-4 text-[var(--text-muted)]"></span></button></div><p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-4 text-[13px] text-[var(--text-muted)]">没有启用分组，正文将只生成场景内容。</p></div>
                        </section>
                    </template>

                    <template v-else-if="subTab === 'photo'">
                        <section class="space-y-5"><div class="flex flex-wrap items-end justify-between gap-3"><div><h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色照片</h4><p class="mt-1 text-[13px] text-[var(--text-muted)]">照片归属于当前视觉 JSON。</p></div><div class="flex gap-2"><button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving" @click="generatePhotoPrompt"><span v-if="activeAction === 'generate_photo_prompt'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>{{ activeAction === 'generate_photo_prompt' ? '等待 LLM 回复…' : '生成 prompt' }}</button><button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving" @click="generateAvatar"><span v-if="activeAction === 'generate_photo'" class="i-lucide-loader-circle h-3.5 w-3.5 animate-spin"></span>{{ activeAction === 'generate_photo' ? '等待 NovelAI…' : '生成照片' }}</button></div></div><div class="grid gap-3 md:grid-cols-2"><label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">用户要求<input v-model="userRequirement" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]" /></label><label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">当前照片 prompt<textarea v-model="photoPrompt" readonly rows="2" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" /></label></div><ul v-if="photos.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"><li v-for="photo in photos" :key="photo"><div class="aspect-square overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]"><img :src="photoUrl(photo)" class="h-full w-full object-cover" :alt="photo" loading="lazy" /></div><span class="mt-1 block truncate text-[12px] text-[var(--text-muted)]">{{ photo }}</span></li></ul><p v-else class="text-[13px] text-[var(--text-muted)]">当前视觉资料还没有照片。</p></section>
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
                <div class="mt-4 flex flex-wrap justify-end gap-2"><button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="pendingDraft = null">取消</button><button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] disabled:opacity-50" :disabled="saving || !activeVisualId" @click="commitDraft('overwrite')">覆盖当前设计</button><button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="commitDraft('create_new')">另存为新设计</button></div>
            </div>
        </div>

        <div v-if="deleteTargetGroup" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <div class="flex items-start justify-between gap-3">
                    <div><h3 class="text-[18px] font-semibold text-[var(--text-main)]">删除分组“{{ deleteTargetGroup.name }}”</h3><p class="mt-1 text-[13px] text-[var(--text-muted)]">删除只移除分组本身：分组内全部角色视觉资料将移动到默认分组。</p></div>
                    <button class="h-8 w-8 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" :disabled="deleteSubmitting" @click="closeDeleteGroupPreview">×</button>
                </div>
                <div v-if="deletePreview" class="mt-4 space-y-2 rounded-md border border-[var(--border-color)] p-3 text-[13px]">
                    <div class="grid grid-cols-2 gap-2">
                        <p class="text-[var(--text-secondary)]">角色：{{ deletePreview.characterCount }} 个</p>
                        <p class="text-[var(--text-secondary)]">视觉资料：{{ deletePreview.visualCount }} 份</p>
                        <p class="text-[var(--text-secondary)]">无法解析的 JSON：{{ deletePreview.invalidFileCount }} 份</p>
                        <p class="text-[var(--text-secondary)]">文件名冲突：{{ deletePreview.fileNameConflictCount }} 处</p>
                        <p class="text-[var(--text-secondary)]">视觉 ID 冲突：{{ deletePreview.visualIdConflictCount }} 处</p>
                        <p class="text-[var(--text-secondary)]">受管引用更新：{{ deletePreview.managedReferenceCount }} 处</p>
                    </div>
                    <p class="text-[var(--text-secondary)]">冲突文件会重命名、冲突视觉 ID 会生成新 ID，原内容不变；角色 Markdown、照片资产和历史任务不受影响。</p>
                    <p v-if="!deletePreview.defaultEnabled" class="rounded-md bg-[var(--warning-bg)] px-2 py-1 text-[var(--warning-text)]">默认分组当前未启用，迁移后的视觉资料暂时不会参与正文自动扫描。</p>
                    <p v-if="!deletePreview && error" class="text-[var(--danger-text)]">{{ error }}</p>
                </div>
                <p v-else class="mt-4 rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">{{ error || "正在重新读取影响摘要…" }}</p>
                <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="deleteSubmitting" @click="closeDeleteGroupPreview">取消</button>
                    <button class="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--danger-bg)] px-3 text-[13px] font-medium text-[var(--danger-text)] disabled:opacity-50" :disabled="deleteSubmitting || !deletePreview" @click="confirmDeleteGroup"><span v-if="deleteSubmitting" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ deleteSubmitting ? "正在迁移视觉资料…" : "确认删除并移动视觉资料" }}</button>
                </div>
            </div>
        </div>

        <div v-if="identitySummary" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div class="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <div class="flex items-start justify-between gap-3">
                    <div><h3 class="text-[18px] font-semibold text-[var(--text-main)]">保存角色身份</h3><p class="mt-1 text-[13px] text-[var(--text-muted)]">中文名、英文名和触发词属于逻辑角色身份，会同步到该角色的全部视觉 JSON。</p></div>
                    <button class="h-8 w-8 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" :disabled="identitySubmitting" @click="identitySummary = null">×</button>
                </div>
                <div class="mt-4 rounded-md border border-[var(--border-color)] p-3 text-[13px] text-[var(--text-secondary)]">
                    <p>将同步 <span class="font-semibold text-[var(--text-main)]">{{ identitySummary.groupCount }}</span> 个分组中的 <span class="font-semibold text-[var(--text-main)]">{{ identitySummary.fileCount }}</span> 份视觉 JSON；当前视觉的其它修改会一并提交。</p>
                    <p v-if="identitySummary.damagedFiles.length" class="mt-2 text-[var(--danger-text)]">存在无法解析的 JSON，保存会整体失败：{{ identitySummary.damagedFiles.join("、") }}</p>
                    <p class="mt-2 text-[12px] text-[var(--text-muted)]">规范化触发词：{{ triggerWordsPreview || "（空，扫描时回退中英文名）" }}</p>
                </div>
                <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="identitySubmitting" @click="identitySummary = null">取消</button>
                    <button class="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="identitySubmitting" @click="confirmIdentitySave"><span v-if="identitySubmitting" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ identitySubmitting ? "正在同步…" : "确认同步保存" }}</button>
                </div>
            </div>
        </div>

        <div v-if="movePreview && moveFrozen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div class="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <div class="flex items-start justify-between gap-3">
                    <div><h3 class="text-[18px] font-semibold text-[var(--text-main)]">确认移动到目标分组</h3><p class="mt-1 text-[13px] text-[var(--text-muted)]">移动当前 JSON；来源不会保留这一份资料。</p></div>
                    <button class="h-8 w-8 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]" :disabled="moveSubmitting" @click="closeMovePreview">×</button>
                </div>
                <div class="mt-4 space-y-2 rounded-md border border-[var(--border-color)] p-3 text-[13px] text-[var(--text-secondary)]">
                    <p v-if="movePreview.equivalentTargetConflict" class="text-[var(--danger-text)]">目标分组存在多份相同内容，需要先在目标分组处理重复项后才能移动。</p>
                    <template v-else>
                        <p v-if="movePreview.equivalentTargetRef">目标分组已有相同内容：将合并到已有版本，不生成第三份资料。</p>
                        <p v-if="movePreview.fileNameConflict">目标分组存在同名文件：将自动改用不冲突的文件名。</p>
                        <p v-if="movePreview.visualIdConflict">目标分组存在相同视觉 ID：将生成新 ID，固定发送引用会同步更新。</p>
                        <p v-if="movePreview.sourceWillLoseCharacter">来源分组只有这一份资料：移动后来源分组不再显示该角色。</p>
                        <p v-if="movePreview.sourceNeedsActiveFallback">来源还有其它版本：将自动选择剩余版本作为来源生效项。</p>
                        <p v-if="movePreview.managedReferenceCount > 0">固定发送引用：{{ movePreview.managedReferenceCount }} 处会同步更新。</p>
                    </template>
                </div>
                <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="moveSubmitting" @click="closeMovePreview">取消</button>
                    <button class="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="moveSubmitting || movePreview.equivalentTargetConflict" @click="submitMove(moveFrozen, movePreview.revision)"><span v-if="moveSubmitting" class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ moveSubmitting ? "正在移动…" : "确认移动" }}</button>
                </div>
            </div>
        </div>

        <div v-if="leaveGuard.pendingMessage.value" class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
            <div class="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <h3 class="text-[16px] font-semibold text-[var(--text-main)]">有未保存的角色视觉修改</h3>
                <p class="mt-2 text-[13px] text-[var(--text-secondary)]">{{ leaveGuard.pendingMessage.value }}</p>
                <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="leaveGuard.chooseCancel">取消</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="leaveGuard.chooseDiscard">放弃</button>
                    <button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="leaveGuard.chooseSave">{{ saving ? "保存中…" : "保存" }}</button>
                </div>
            </div>
        </div>

        <footer v-if="error || loading || activeAction" class="shrink-0 border-t border-[var(--border-color)] px-4 py-2"><p v-if="error" class="text-[13px] text-[var(--danger-text)]">{{ error }}</p><p v-else-if="activeAction" class="inline-flex items-center gap-2 text-[13px] text-[var(--status-info)]"><span class="i-lucide-loader-circle h-4 w-4 animate-spin"></span>{{ activeActionLabel }}</p><p v-else class="text-[13px] text-[var(--text-muted)]">加载中...</p></footer>
    </div>
</template>
