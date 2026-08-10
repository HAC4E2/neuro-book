<script setup lang="ts">
import {onMounted, ref, watch} from "vue";
import {
    TextToImageProjectSendDataSchema,
    type TextToImageProjectSendData,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const props = defineProps<{
    projectRoot: string;
}>();

type SendDataResponse = {
    sendData: TextToImageProjectSendData;
    lorebookEntries: Array<{path: string; title: string}>;
    characters: Array<{
        characterId: string;
        groupId: string | null;
        cnName: string;
        enName: string;
        outfits: Array<{name: string; cnName: string; enName: string}>;
    }>;
};

const sendData = ref<TextToImageProjectSendData>(TextToImageProjectSendDataSchema.parse({}));
const lorebookEntries = ref<SendDataResponse["lorebookEntries"]>([]);
const characters = ref<SendDataResponse["characters"]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const saved = ref(false);

onMounted(() => {
    void load();
});

watch(() => props.projectRoot, () => {
    void load();
});

async function load(): Promise<void> {
    if (!props.projectRoot.trim()) return;
    loading.value = true;
    error.value = "";
    saved.value = false;
    try {
        const result = await $fetch<SendDataResponse>("/api/text-to-image/project-send-data", {
            query: {projectRoot: props.projectRoot},
        });
        sendData.value = TextToImageProjectSendDataSchema.parse(result.sendData);
        lorebookEntries.value = result.lorebookEntries;
        characters.value = result.characters;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "加载发送数据失败");
    } finally {
        loading.value = false;
    }
}

async function save(): Promise<void> {
    saving.value = true;
    error.value = "";
    saved.value = false;
    try {
        const result = await $fetch<{sendData: TextToImageProjectSendData}>("/api/text-to-image/project-send-data", {
            method: "PUT",
            body: {projectRoot: props.projectRoot, sendData: sendData.value},
        });
        sendData.value = TextToImageProjectSendDataSchema.parse(result.sendData);
        saved.value = true;
    } catch (cause) {
        error.value = resolveApiErrorMessage(cause, "保存发送数据失败");
    } finally {
        saving.value = false;
    }
}

function toggleLorebook(relativePath: string): void {
    sendData.value.lorebookPaths = toggleValue(sendData.value.lorebookPaths, relativePath);
}

function toggleCharacter(characterId: string, groupId: string | null): void {
    const characterItem = characters.value.find((item) => item.characterId === characterId && item.groupId === groupId);
    if (!characterItem) return;
    const selection = {characterId, groupId: characterItem.groupId};
    const exists = sendData.value.characterSelections.some((item) => (
        item.characterId === selection.characterId && item.groupId === selection.groupId
    ));
    sendData.value.characterSelections = exists
        ? sendData.value.characterSelections.filter((item) => (
            item.characterId !== selection.characterId || item.groupId !== selection.groupId
        ))
        : [...sendData.value.characterSelections, selection];
    sendData.value.characterIds = [...new Set(sendData.value.characterSelections.map((item) => item.characterId))];
}

function toggleOutfit(characterId: string, name: string): void {
    const characterItem = characters.value.find((item) => item.characterId === characterId);
    const groupId = characterItem?.groupId ?? null;
    const exists = sendData.value.outfitSelections.some((item) => item.characterId === characterId && item.groupId === groupId && item.name === name);
    sendData.value.outfitSelections = exists
        ? sendData.value.outfitSelections.filter((item) => !(item.characterId === characterId && item.groupId === groupId && item.name === name))
        : [...sendData.value.outfitSelections, {characterId, groupId, name}];
}

function toggleValue(values: string[], value: string): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function isOutfitSelected(characterId: string, name: string): boolean {
    const characterItem = characters.value.find((item) => item.characterId === characterId);
    const groupId = characterItem?.groupId ?? null;
    return sendData.value.outfitSelections.some((item) => item.characterId === characterId && item.groupId === groupId && item.name === name);
}

function isCharacterSelected(characterId: string, groupId: string | null): boolean {
    return sendData.value.characterSelections.some((item) => item.characterId === characterId && item.groupId === groupId);
}
</script>

<template>
    <section class="flex h-full min-h-0 flex-col">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4">
            <div>
                <h3 class="text-[18px] font-semibold text-[var(--text-main)]">发送数据</h3>
                <p class="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">按当前 Project 保存 Lorebook、角色和独立服装选择。请求开始时由后端冻结内容，切换界面不会改变已入队请求。</p>
            </div>
            <button class="rounded-md bg-[var(--accent-bg)] px-3 py-2 text-[13px] text-[var(--accent-text)] disabled:opacity-50" :disabled="saving || loading" @click="save">
                {{ saving ? "保存中…" : "保存选择" }}
            </button>
        </header>

        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
            <p v-if="loading" class="text-[13px] text-[var(--text-muted)]">加载中…</p>
            <p v-else-if="error" class="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger-text)]">{{ error }}</p>
            <div v-else class="grid gap-5 xl:grid-cols-3">
                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">Lorebook 条目</h4>
                    <div v-if="lorebookEntries.length === 0" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有可发送条目。</div>
                    <label v-for="entry in lorebookEntries" :key="entry.path" class="mb-2 flex cursor-pointer items-start gap-2 text-[13px] text-[var(--text-secondary)]">
                        <input class="mt-0.5 accent-[var(--accent-bg)]" type="checkbox" :checked="sendData.lorebookPaths.includes(entry.path)" @change="toggleLorebook(entry.path)">
                        <span class="min-w-0"><span class="block text-[var(--text-main)]">{{ entry.title }}</span><span class="block truncate text-[11px] text-[var(--text-muted)]">{{ entry.path }}</span></span>
                    </label>
                </div>

                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">角色启用列表</h4>
                    <div v-if="characters.length === 0" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有视觉角色资料。</div>
                    <label v-for="characterItem in characters" :key="`${characterItem.groupId ?? 'legacy'}-${characterItem.characterId}`" class="mb-2 flex cursor-pointer items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                        <input class="accent-[var(--accent-bg)]" type="checkbox" :checked="isCharacterSelected(characterItem.characterId, characterItem.groupId)" @change="toggleCharacter(characterItem.characterId, characterItem.groupId)">
                        <span class="truncate text-[var(--text-main)]">{{ characterItem.cnName || characterItem.enName || characterItem.characterId }}</span>
                        <span v-if="characterItem.enName" class="truncate text-[11px] text-[var(--text-muted)]">{{ characterItem.enName }}</span>
                        <span class="truncate text-[11px] text-[var(--text-muted)]">{{ characterItem.groupId ?? "旧版" }}</span>
                    </label>
                </div>

                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">独立服装列表</h4>
                    <div v-if="characters.every((item) => item.outfits.length === 0)" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有可发送服装。</div>
                    <template v-for="characterItem in characters" :key="`${characterItem.groupId ?? 'legacy'}-${characterItem.characterId}-outfits`">
                        <p v-if="characterItem.outfits.length > 0" class="mb-1 mt-3 text-[12px] text-[var(--text-muted)]">{{ characterItem.cnName || characterItem.enName || characterItem.characterId }}</p>
                        <label v-for="outfit in characterItem.outfits" :key="`${characterItem.characterId}-${outfit.name}`" class="mb-2 flex cursor-pointer items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                            <input class="accent-[var(--accent-bg)]" type="checkbox" :checked="isOutfitSelected(characterItem.characterId, outfit.name)" @change="toggleOutfit(characterItem.characterId, outfit.name)">
                            <span class="truncate text-[var(--text-main)]">{{ outfit.cnName || outfit.enName }}</span>
                            <span v-if="outfit.enName && outfit.cnName" class="truncate text-[11px] text-[var(--text-muted)]">{{ outfit.enName }}</span>
                        </label>
                    </template>
                </div>
            </div>
        </div>
        <p v-if="saved" class="border-t border-[var(--border-color)] px-5 py-2 text-[13px] text-[var(--success-text)]">发送数据已保存。</p>
    </section>
</template>
