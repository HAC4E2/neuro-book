<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {
    characterListItemKey,
    filterCharacterList,
} from "nbook/app/components/novel-ide/text-to-image/character-list";
import type {CharacterGenerationContext} from "nbook/app/components/novel-ide/text-to-image/character-context";
import {
    characterDetailFieldGroups,
    characterDetailFieldLabels,
    characterWorkbenchSections,
    type CharacterWorkbenchSectionId,
    outfitDetailFields,
} from "nbook/app/components/novel-ide/text-to-image/character-workbench";

const props = defineProps<{
    projectRoot: string;
    initialCharacter?: CharacterGenerationContext | null;
}>();

type CharacterGroupInfo = {
    groupId: string;
    name: string;
    description: string;
};

type CharacterListItem = {
    characterId: string;
    groupId: string | null;
    characterPage: string;
    cnName: string;
    enName: string;
    triggerWords: string;
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
    characterId: string;
    character: Record<string, string>;
    outfits: CharacterOutfit[];
    photos: string[];
};

const defaultCharacterFields = {
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

const subTab = ref<CharacterWorkbenchSectionId>("character");
const groups = ref<CharacterGroupInfo[]>([]);
const activeGroupId = ref("");
const activeCharacterGroupId = ref<string | null>(null);
const characterGroupFilter = ref<"all" | string>("all");
const allCharacters = ref<CharacterListItem[]>([]);
const activeCharacterId = ref("");
const character = ref({...defaultCharacterFields});
const outfits = ref<CharacterOutfit[]>([]);
const activeOutfitIndex = ref(-1);
const outfitDraft = ref<CharacterOutfit>({...defaultOutfit});
const photos = ref<string[]>([]);
const characterPage = ref("");
const userRequirement = ref("");
const photoPrompt = ref("");
const newGroupId = ref("");
const newGroupName = ref("");
const newCharacterId = ref("");
const groupNameDraft = ref("");
const groupDescriptionDraft = ref("");
const enabledCharacterQuery = ref("");
const error = ref("");
const loading = ref(false);
const saving = ref(false);

const activeGroup = computed(() => groups.value.find((group) => group.groupId === activeGroupId.value) ?? null);
const activeCharacterGroup = computed(() => (
    activeCharacterGroupId.value
        ? groups.value.find((group) => group.groupId === activeCharacterGroupId.value) ?? null
        : null
));
const filteredCharacters = computed(() => filterCharacterList(allCharacters.value, characterGroupFilter.value));
const activeOutfit = computed(() => (
    activeOutfitIndex.value >= 0 && activeOutfitIndex.value < outfits.value.length
        ? outfits.value[activeOutfitIndex.value]
        : null
));
const enabledCharacters = computed(() => {
    const query = enabledCharacterQuery.value.trim().toLocaleLowerCase();
    if (!query) return allCharacters.value;
    return allCharacters.value.filter((item) => (
        [item.characterId, item.cnName, item.enName, item.triggerWords]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)
    ));
});

onMounted(() => {
    void loadAll();
});

watch(() => props.projectRoot, () => {
    void loadAll();
});

watch(() => props.initialCharacter, () => {
    applyInitialCharacterContext();
}, {immediate: true});

watch([activeCharacterId, activeCharacterGroupId], () => {
    void loadVisual();
});

watch(activeOutfitIndex, () => {
    syncOutfitDraft();
}, {immediate: true});

async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
        await Promise.all([
            loadGroups(),
            loadAllCharacters(),
        ]);
        applyInitialCharacterContext();
        if (!groups.value.some((group) => group.groupId === activeGroupId.value)) {
            activeGroupId.value = groups.value[0]?.groupId ?? "";
        }
        if (characterGroupFilter.value !== "all"
            && !groups.value.some((group) => group.groupId === characterGroupFilter.value)) {
            characterGroupFilter.value = "all";
        }
        if (!activeCharacterId.value) {
            const firstCharacter = allCharacters.value[0];
            if (firstCharacter) {
                activeCharacterId.value = firstCharacter.characterId;
                activeCharacterGroupId.value = firstCharacter.groupId;
            }
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加载角色数据失败");
    } finally {
        loading.value = false;
    }
}

async function loadGroups(): Promise<void> {
    const result = await $fetch<{groups: CharacterGroupInfo[]}>("/api/text-to-image/character-groups", {
        query: {projectRoot: props.projectRoot},
    });
    groups.value = result.groups.length > 0
        ? [result.groups[0]!]
        : [{groupId: "default", name: "当前项目", description: "项目角色集合"}];
    if (!groups.value.some((group) => group.groupId === activeGroupId.value)) {
        activeGroupId.value = groups.value[0]?.groupId ?? "";
    }
}

async function loadAllCharacters(): Promise<void> {
    const result = await $fetch<{characters: CharacterListItem[]}>("/api/text-to-image/character-visual.list", {
        query: {projectRoot: props.projectRoot},
    });
    allCharacters.value = result.characters;
}

function applyInitialCharacterContext(): void {
    const context = props.initialCharacter;
    if (!context) {
        characterPage.value = "";
        return;
    }
    characterPage.value = context.characterPage;
    activeCharacterId.value = context.characterId;
    activeCharacterGroupId.value = context.groupId;
    if (context.groupId && groups.value.some((group) => group.groupId === context.groupId)) {
        activeGroupId.value = context.groupId;
    }
}

async function loadVisual(): Promise<void> {
    if (!activeCharacterId.value) {
        resetCharacterForm();
        return;
    }
    loading.value = true;
    error.value = "";
    try {
        const result = await $fetch<{visual: CharacterVisual | null}>("/api/text-to-image/character-visual", {
            query: {
                projectRoot: props.projectRoot,
                characterId: activeCharacterId.value,
            },
        });
        if (result.visual) {
            character.value = {...defaultCharacterFields, ...result.visual.character};
            outfits.value = result.visual.outfits.map((outfit) => ({...outfit}));
            photos.value = result.visual.photos ?? [];
            activeOutfitIndex.value = outfits.value.length > 0 ? 0 : -1;
        } else {
            resetCharacterForm();
        }
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "读取角色视觉失败");
    } finally {
        loading.value = false;
    }
}

function resetCharacterForm(): void {
    character.value = {...defaultCharacterFields};
    outfits.value = [];
    activeOutfitIndex.value = -1;
    outfitDraft.value = {...defaultOutfit};
    photos.value = [];
    photoPrompt.value = "";
}

function syncOutfitDraft(): void {
    const outfit = activeOutfit.value;
    outfitDraft.value = outfit ? {...outfit} : {...defaultOutfit};
}

function applyOutfitDraft(): void {
    if (activeOutfitIndex.value >= 0 && activeOutfitIndex.value < outfits.value.length) {
        outfits.value[activeOutfitIndex.value] = {...outfitDraft.value};
    }
}

function buildVisual(): CharacterVisual {
    applyOutfitDraft();
    return {
        schema: "nbook.character-visual/v1",
        characterId: activeCharacterId.value,
        character: {...character.value},
        outfits: outfits.value.map((outfit) => ({...outfit})),
        photos: [...photos.value],
    };
}

function photoUrl(photo: string): string {
    return `/api/text-to-image/assets/by-path/content?projectRoot=${encodeURIComponent(props.projectRoot)}&relativePath=${encodeURIComponent(photo)}`;
}

async function createGroup(): Promise<void> {
    const groupId = newGroupId.value.trim();
    if (!groupId) {
        error.value = "请输入分组 ID";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-groups", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                groupId,
                name: newGroupName.value.trim() || undefined,
            },
        });
        newGroupId.value = "";
        newGroupName.value = "";
        await loadGroups();
        activeGroupId.value = groupId;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "创建分组失败");
    } finally {
        saving.value = false;
    }
}

async function renameGroup(): Promise<void> {
    if (!activeGroupId.value) return;
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-groups", {
            method: "PUT",
            body: {
                projectRoot: props.projectRoot,
                groupId: activeGroupId.value,
                name: groupNameDraft.value.trim(),
                description: groupDescriptionDraft.value.trim(),
            },
        });
        await loadGroups();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存分组失败");
    } finally {
        saving.value = false;
    }
}

async function deleteGroup(): Promise<void> {
    const groupId = activeGroupId.value;
    if (!groupId) return;
    if (!await confirm(`删除分组「${groupId}」会同时删除该分组下的全部角色视觉数据，确定继续吗？`)) {
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-groups", {
            method: "DELETE",
            query: {
                projectRoot: props.projectRoot,
                groupId,
            },
        });
        activeGroupId.value = "";
        await loadGroups();
        await loadAllCharacters();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除分组失败");
    } finally {
        saving.value = false;
    }
}

function createCharacter(): void {
    const characterId = newCharacterId.value.trim();
    if (!characterId) {
        error.value = "请输入角色 ID";
        return;
    }
    if (!activeGroupId.value) {
        error.value = "请先选择角色分组";
        return;
    }
    activeCharacterGroupId.value = activeGroupId.value;
    activeCharacterId.value = characterId;
    newCharacterId.value = "";
    resetCharacterForm();
}

function selectCharacter(characterId: string, groupId?: string | null, characterPagePath = ""): void {
    activeCharacterGroupId.value = groupId ?? null;
    if (characterPagePath) {
        characterPage.value = characterPagePath;
    }
    if (groupId && activeGroupId.value !== groupId) {
        activeGroupId.value = groupId;
    }
    activeCharacterId.value = characterId;
    subTab.value = "character";
}

async function deleteCharacter(): Promise<void> {
    const characterId = activeCharacterId.value;
    if (!characterId) return;
    if (!await confirm(`清除角色「${characterId}」的视觉资料和登记照片？原始 Markdown 档案不会被删除。`)) {
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-visual", {
            method: "DELETE",
            query: {
                projectRoot: props.projectRoot,
                characterId,
            },
        });
        activeCharacterId.value = "";
        activeCharacterGroupId.value = null;
        await loadAllCharacters();
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "删除角色失败");
    } finally {
        saving.value = false;
    }
}

async function saveVisual(): Promise<void> {
    if (!activeCharacterId.value) {
        error.value = "请先选择角色分组和角色";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-visual", {
            method: "PUT",
            body: {
                projectRoot: props.projectRoot,
                characterId: activeCharacterId.value,
                visual: buildVisual(),
            },
        });
        await Promise.all([
            loadVisual(),
            loadAllCharacters(),
        ]);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存角色视觉失败");
    } finally {
        saving.value = false;
    }
}

function addOutfit(): void {
    outfits.value.push({...defaultOutfit});
    activeOutfitIndex.value = outfits.value.length - 1;
}

function removeOutfit(index: number): void {
    outfits.value.splice(index, 1);
    if (activeOutfitIndex.value >= outfits.value.length) {
        activeOutfitIndex.value = outfits.value.length - 1;
    }
    syncOutfitDraft();
}

async function generateVisual(): Promise<void> {
    if (!activeCharacterId.value) {
        error.value = "请先选择角色";
        return;
    }
    if (characterPage.value.trim() === "") {
        error.value = "请从角色详情页打开角色 Tag 生成";
        return;
    }
    saving.value = true;
    error.value = "";
    try {
        await $fetch("/api/text-to-image/character-visual.generate", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                characterId: activeCharacterId.value,
                characterPage: characterPage.value,
                mode: "fill_empty",
            },
        });
        await Promise.all([
            loadVisual(),
            loadAllCharacters(),
        ]);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色 Tag 失败");
    } finally {
        saving.value = false;
    }
}

async function generatePhotoPrompt(): Promise<void> {
    error.value = "";
    applyOutfitDraft();
    try {
        const result = await $fetch<{prompt: string}>("/api/text-to-image/character-photo.generate-prompt", {
            method: "POST",
            body: {
                characterText: JSON.stringify(character.value),
                outfitText: JSON.stringify(activeOutfit.value ?? []),
                userRequirement: userRequirement.value,
            },
        });
        photoPrompt.value = result.prompt;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成照片 prompt 失败");
    }
}

async function generateAvatar(): Promise<void> {
    if (!activeCharacterId.value) {
        error.value = "请先选择角色";
        return;
    }
    saving.value = true;
    error.value = "";
    applyOutfitDraft();
    try {
        await $fetch("/api/text-to-image/character-photo.generate", {
            method: "POST",
            body: {
                projectRoot: props.projectRoot,
                characterId: activeCharacterId.value,
                characterText: JSON.stringify(character.value),
                outfitText: JSON.stringify(activeOutfit.value ?? []),
                userRequirement: userRequirement.value,
            },
        });
        await Promise.all([
            loadVisual(),
            loadAllCharacters(),
        ]);
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "生成角色照片失败");
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col bg-[var(--bg-main)]">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3">
            <div class="min-w-0">
                <h2 class="truncate text-[18px] font-semibold text-[var(--text-main)]">角色管理</h2>
                <p class="mt-1 truncate text-[13px] text-[var(--text-muted)]">
                    {{ activeCharacterGroup?.name || "未分组" }}
                    <span v-if="activeCharacterId"> · {{ activeCharacterId }}</span>
                </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
                <button
                    class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    :disabled="saving || !activeCharacterId"
                    title="保存当前角色"
                    @click="saveVisual"
                >
                    <span class="i-lucide-save h-4 w-4"></span>
                    保存
                </button>
                <button
                    class="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--danger-border)] px-3 text-[14px] text-[var(--danger-text)] hover:bg-[var(--danger-bg)] disabled:opacity-50"
                    :disabled="saving || !activeCharacterId"
                            title="清除当前角色视觉资料"
                    @click="deleteCharacter"
                >
                    <span class="i-lucide-trash-2 h-4 w-4"></span>
                                清除视觉资料
                </button>
            </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
            <aside class="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-b border-[var(--border-color)] p-3 lg:w-72 lg:border-b-0 lg:border-r">
                <section>
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <div>
                            <h3 class="text-[15px] font-semibold text-[var(--text-main)]">当前项目</h3>
                            <p class="mt-1 text-[12px] text-[var(--text-muted)]">角色统一归属于当前项目，不再新建分组。</p>
                        </div>
                        <span class="i-lucide-folder-open h-4 w-4 text-[var(--accent-text)]"></span>
                    </div>
                    <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-hover)] px-3 py-2 text-[14px] text-[var(--text-secondary)]">
                        {{ activeGroup?.name || "项目角色集合" }}
                    </div>
                </section>

                <section class="border-t border-[var(--border-color)] pt-4">
                    <div class="mb-2 flex items-center justify-between gap-2">
                        <div>
                            <h3 class="text-[15px] font-semibold text-[var(--text-main)]">角色</h3>
                            <p class="mt-1 truncate text-[12px] text-[var(--text-muted)]">当前项目中的全部角色</p>
                        </div>
                        <span class="text-[12px] text-[var(--text-muted)]">{{ filteredCharacters.length }}</span>
                    </div>
                    <div v-if="filteredCharacters.length > 0" class="space-y-1">
                        <button
                            v-for="item in filteredCharacters"
                            :key="characterListItemKey(item)"
                            class="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[14px] hover:bg-[var(--bg-hover)]"
                            :class="activeCharacterId === item.characterId && activeCharacterGroupId === item.groupId ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'"
                            @click="selectCharacter(item.characterId, item.groupId, item.characterPage)"
                        >
                            <span class="i-lucide-user-round h-4 w-4 shrink-0 opacity-70"></span>
                            <span class="min-w-0 truncate">{{ item.cnName || item.enName || item.characterId }}</span>
                            <span v-if="item.triggerWords.trim()" class="i-lucide-tag h-3.5 w-3.5 shrink-0 opacity-70" title="已有触发词"></span>
                        </button>
                    </div>
                    <p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">
                        当前项目下还没有角色。
                    </p>
                    <!-- 瑙掕壊鐢熸垚浠庡師濮嬫枃浠跺紑濮嬶紝涓嶅湪瑙嗚绠＄悊涓柊寤洪櫤鏃朵汉鐗? -->
                    <div v-if="false" class="mt-3 space-y-2 border-t border-[var(--border-color)] pt-3">
                        <input
                            v-model="newCharacterId"
                            class="h-8 w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[13px] text-[var(--text-main)]"
                            placeholder="新角色 ID"
                        />
                        <button
                            class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--border-color)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                            :disabled="!activeGroupId"
                            @click="createCharacter"
                        >
                            <span class="i-lucide-plus h-4 w-4"></span>
                            新建角色
                        </button>
                    </div>
                </section>
            </aside>

            <main class="min-w-0 flex-1 overflow-y-auto p-4">
                <div v-if="!activeCharacterId" class="flex min-h-72 items-center justify-center rounded-md border border-dashed border-[var(--border-color)] p-6 text-center">
                    <div>
                        <span class="i-lucide-users-round mx-auto h-8 w-8 text-[var(--text-muted)]"></span>
                        <h3 class="mt-3 text-[16px] font-semibold text-[var(--text-main)]">先从角色列表选择角色</h3>
                        <p class="mt-1 text-[13px] text-[var(--text-muted)]">角色档案来自当前项目，视觉资料与原始档案分开保存。</p>
                    </div>
                </div>

                <template v-else>
                    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p class="text-[12px] uppercase tracking-[0.08em] text-[var(--text-muted)]">当前项目</p>
                            <h3 class="mt-1 text-[20px] font-semibold text-[var(--text-main)]">{{ activeCharacterGroup?.name || "未分组" }}</h3>
                            <p v-if="activeCharacterGroup?.description" class="mt-1 max-w-2xl text-[13px] text-[var(--text-secondary)]">{{ activeCharacterGroup.description }}</p>
                        </div>
                        <div class="flex items-center gap-2">
                            <span v-if="activeCharacterId" class="rounded-md bg-[var(--bg-hover)] px-2 py-1 text-[13px] text-[var(--text-secondary)]">{{ activeCharacterId }}</span>
                            <button
                                class="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50"
                                :disabled="saving || !activeCharacterId"
                                @click="saveVisual"
                            >
                                <span class="i-lucide-save h-3.5 w-3.5"></span>
                                保存当前页
                            </button>
                        </div>
                    </div>

                    <nav class="mb-4 flex flex-wrap gap-1 border-b border-[var(--border-color)]">
                        <button
                            v-for="section in characterWorkbenchSections"
                            :key="section.id"
                            class="inline-flex h-9 items-center gap-2 border-b-2 px-3 text-[14px]"
                            :class="subTab === section.id ? 'border-[var(--accent-main)] text-[var(--accent-text)]' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'"
                            @click="subTab = section.id"
                        >
                            <span :class="[section.icon, 'h-4 w-4']"></span>
                            {{ section.label }}
                        </button>
                    </nav>

                    <template v-if="subTab === 'character'">
                        <section class="border-b border-[var(--border-color)] pb-5">
                            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色详情</h4>
                                    <p class="mt-1 text-[13px] text-[var(--text-muted)]">这些字段会写入当前角色的 `visual.json`，正文生图只读取其中的视觉 Tag。</p>
                                </div>
                                <p class="text-[13px] text-[var(--text-muted)]">使用 LLM 管理中“角色设计”绑定的模型。</p>
                            </div>

                            <div class="space-y-5">
                                <section v-for="group in characterDetailFieldGroups" :key="group.id">
                                    <div class="mb-2 flex items-center gap-2">
                                        <span class="h-1.5 w-1.5 rounded-full bg-[var(--accent-main)]"></span>
                                        <h5 class="text-[14px] font-medium text-[var(--text-main)]">{{ group.title }}</h5>
                                    </div>
                                    <div class="grid gap-3 md:grid-cols-2">
                                        <label
                                            v-for="field in group.fields"
                                            :key="field"
                                            class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]"
                                            :class="field === 'negativePrompt' ? 'md:col-span-2' : ''"
                                        >
                                            {{ characterDetailFieldLabels[field] }}
                                            <textarea
                                                v-model="character[field]"
                                                :rows="field === 'negativePrompt' ? 4 : 2"
                                                class="w-full resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] leading-5 text-[var(--text-main)]"
                                            />
                                        </label>
                                    </div>
                                </section>
                            </div>
                        </section>

                        <section class="border-b border-[var(--border-color)] py-5">
                            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色 Tag 生成</h4>
                                    <p class="mt-1 text-[13px] text-[var(--text-muted)]">入口只在角色详情页出现，LLM 返回的字段由工作台后端写回当前角色。</p>
                                </div>
                                <button
                                    class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50"
                                    :disabled="saving || !characterPage.trim()"
                                    @click="generateVisual"
                                >
                                    <span class="i-lucide-sparkles h-3.5 w-3.5"></span>
                                    生成角色 Tag
                                </button>
                            </div>
                            <pre v-if="characterPage.trim()" class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-3 font-mono text-[13px] leading-5 text-[var(--text-main)]">{{ characterPage }}</pre>
                            <p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">从角色 Markdown 详情页进入时，这里会自动带入正文；当前角色尚未绑定可生成的角色页。</p>
                        </section>

                        <section class="py-5">
                            <div class="mb-3 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">角色照片</h4>
                                    <p class="mt-1 text-[13px] text-[var(--text-muted)]">照片生成仍由 LLM 生成 prompt，再由 NovelAI 后端完成出图。</p>
                                </div>
                                <div class="flex items-center gap-2">
                                    <button
                                        class="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                                        :disabled="false"
                                        @click="generatePhotoPrompt"
                                    >
                                        <span class="i-lucide-lightbulb h-3.5 w-3.5"></span>
                                        生成 prompt
                                    </button>
                                    <button
                                        class="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                                        :disabled="saving || !activeCharacterId"
                                        @click="generateAvatar"
                                    >
                                        <span class="i-lucide-image-plus h-3.5 w-3.5"></span>
                                        生成照片
                                    </button>
                                </div>
                            </div>
                            <div class="grid gap-3 md:grid-cols-2">
                                <label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">
                                    用户要求
                                    <input v-model="userRequirement" class="h-8 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2 text-[14px] text-[var(--text-main)]" />
                                </label>
                                <label class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">
                                    当前照片 prompt
                                    <textarea v-model="photoPrompt" readonly rows="2" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] text-[var(--text-main)]" />
                                </label>
                            </div>
                            <ul v-if="photos.length > 0" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                <li v-for="photo in photos" :key="photo" class="min-w-0">
                                    <div class="aspect-square overflow-hidden rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]">
                                        <img :src="photoUrl(photo)" class="h-full w-full object-cover" :alt="photo" loading="lazy" />
                                    </div>
                                    <span class="mt-1 block truncate text-[12px] text-[var(--text-muted)]" :title="photo">{{ photo }}</span>
                                </li>
                            </ul>
                            <p v-else class="mt-3 text-[13px] text-[var(--text-muted)]">当前角色还没有照片资产。</p>
                        </section>
                    </template>

                    <template v-else-if="subTab === 'outfit'">
                        <div class="grid min-h-96 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                            <section class="border-r border-[var(--border-color)] pr-4">
                                <div class="mb-3 flex items-center justify-between gap-2">
                                    <div>
                                        <h4 class="text-[16px] font-semibold text-[var(--text-main)]">服装详情</h4>
                                        <p class="mt-1 text-[13px] text-[var(--text-muted)]">服装与角色 Tag 分开维护。</p>
                                    </div>
                                    <button
                                        class="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                        title="新增服装"
                                        @click="addOutfit"
                                    >
                                        <span class="i-lucide-plus h-4 w-4"></span>
                                    </button>
                                </div>
                                <div v-if="outfits.length > 0" class="space-y-1">
                                    <button
                                        v-for="(outfit, index) in outfits"
                                        :key="index"
                                        class="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                                        :class="activeOutfitIndex === index ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : ''"
                                        @click="activeOutfitIndex = index"
                                    >
                                        <span class="min-w-0 truncate">{{ outfit.cnName || outfit.enName || `服装 ${index + 1}` }}</span>
                                        <span class="text-[11px] opacity-70">{{ index + 1 }}</span>
                                    </button>
                                </div>
                                <p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-3 text-[13px] text-[var(--text-muted)]">还没有服装，点击加号创建。</p>
                                <button
                                    v-if="activeOutfit"
                                    class="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-[var(--danger-border)] text-[13px] text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                                    @click="removeOutfit(activeOutfitIndex)"
                                >
                                    <span class="i-lucide-trash-2 h-3.5 w-3.5"></span>
                                    删除当前服装
                                </button>
                            </section>
                            <section>
                                <div v-if="activeOutfit" class="space-y-4">
                                    <div class="flex items-center justify-between gap-2">
                                        <div>
                                            <h5 class="text-[15px] font-semibold text-[var(--text-main)]">{{ outfitDraft.cnName || outfitDraft.enName || "未命名服装" }}</h5>
                                            <p class="mt-1 text-[12px] text-[var(--text-muted)]">保存角色时一并写入当前角色的 `visual.json`。</p>
                                        </div>
                                        <button
                                            class="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50"
                                            :disabled="saving || !activeCharacterId"
                                            @click="saveVisual"
                                        >
                                            <span class="i-lucide-save h-3.5 w-3.5"></span>
                                            保存服装
                                        </button>
                                    </div>
                                    <div class="grid gap-3 md:grid-cols-2">
                                        <label v-for="field in outfitDetailFields" :key="field.key" class="flex flex-col gap-1 text-[13px] text-[var(--text-secondary)]">
                                            {{ field.label }}
                                            <textarea v-model="outfitDraft[field.key]" rows="3" class="resize-y rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-[14px] leading-5 text-[var(--text-main)]" />
                                        </label>
                                    </div>
                                </div>
                                <div v-else class="flex min-h-72 items-center justify-center rounded-md border border-dashed border-[var(--border-color)] p-6 text-center text-[13px] text-[var(--text-muted)]">选择或新增服装后编辑详情。</div>
                            </section>
                        </div>
                    </template>

                    <template v-else>
                        <section>
                            <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <h4 class="text-[16px] font-semibold text-[var(--text-main)]">当前启用角色</h4>
                                    <p class="mt-1 text-[13px] text-[var(--text-muted)]">这里显示当前项目中已有触发词的角色，正文扫描会从这些视觉数据中匹配。</p>
                                </div>
                                <label class="relative">
                                    <span class="sr-only">筛选角色</span>
                                    <span class="i-lucide-search pointer-events-none absolute left-2 top-2 h-4 w-4 text-[var(--text-muted)]"></span>
                                    <input v-model="enabledCharacterQuery" class="h-8 w-56 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] pl-8 pr-2 text-[13px] text-[var(--text-main)]" placeholder="筛选角色或触发词" />
                                </label>
                            </div>
                            <div v-if="enabledCharacters.length > 0" class="grid gap-2 md:grid-cols-2">
                                <button
                                    v-for="item in enabledCharacters"
                                    :key="characterListItemKey(item)"
                                    class="flex items-start justify-between gap-3 rounded-md border border-[var(--border-color)] p-3 text-left hover:bg-[var(--bg-hover)]"
                                    @click="selectCharacter(item.characterId, item.groupId, item.characterPage)"
                                >
                                    <span class="min-w-0">
                                        <span class="flex items-center gap-2 text-[14px] font-medium text-[var(--text-main)]">
                                            <span class="i-lucide-badge-check h-4 w-4 text-[var(--success-text)]"></span>
                                            {{ item.cnName || item.enName || item.characterId }}
                                        </span>
                                        <span class="mt-1 block truncate text-[12px] text-[var(--text-muted)]">{{ item.characterId }}</span>
                                    </span>
                                    <span class="max-w-48 shrink-0 truncate text-[12px] text-[var(--text-secondary)]" :title="item.triggerWords">{{ item.triggerWords }}</span>
                                </button>
                            </div>
                            <p v-else class="rounded-md border border-dashed border-[var(--border-color)] p-5 text-center text-[13px] text-[var(--text-muted)]">
                                {{ enabledCharacterQuery ? "没有匹配的已启用角色。" : "当前项目还没有带触发词的角色。" }}
                            </p>
                        </section>
                    </template>
                </template>
            </main>
        </div>

        <footer v-if="error || loading" class="shrink-0 border-t border-[var(--border-color)] px-4 py-2">
            <p v-if="error" class="text-[13px] text-[var(--danger-text)]">{{ error }}</p>
            <p v-else-if="loading" class="text-[13px] text-[var(--text-muted)]">加载中...</p>
        </footer>
    </div>
</template>
