<script setup lang="ts">
import {computed, onMounted, ref, watch} from "vue";
import {
    TextToImageProjectSendDataSchema,
    type TextToImageProjectSendData,
} from "nbook/shared/dto/text-to-image.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useUnsavedGuard} from "nbook/app/components/novel-ide/text-to-image/leave-guard";

const props = defineProps<{
    projectRoot: string;
}>();

type SendDataResponse = {
    sendData: TextToImageProjectSendData;
    lorebookEntries: Array<{path: string; title: string}>;
    characters: Array<{
        characterId: string;
        groupId: string | null;
        visualId: string;
        cnName: string;
        enName: string;
        outfits: Array<{name: string; cnName: string; enName: string}>;
    }>;
};

const emptySendData = (): TextToImageProjectSendData => TextToImageProjectSendDataSchema.parse({});

/** 服务端已保存、会进入下一次请求的快照。 */
const savedSendData = ref<TextToImageProjectSendData>(emptySendData());
/** 页面内编辑副本；只有点击“保存选择”后才会成为服务端快照。 */
const sendData = ref<TextToImageProjectSendData>(emptySendData());
const lorebookEntries = ref<SendDataResponse["lorebookEntries"]>([]);
const characters = ref<SendDataResponse["characters"]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const saved = ref(false);
const loadToken = ref(0);
/** 当前页面状态实际绑定并加载的 Project 根；外部 prop 变化必须经过离开保护后才提交。 */
const loadedProjectRoot = ref("");

onMounted(() => {
    loadedProjectRoot.value = props.projectRoot;
    void load();
});

watch(() => props.projectRoot, async (next, previous) => {
    if (!previous || next === previous || next === loadedProjectRoot.value) return;
    if (await leaveGuard.guard("切换 Project 会丢失未保存的发送数据选择")) {
        loadedProjectRoot.value = next;
        await load();
    } else {
        error.value = "Project 切换已取消；当前页面仍绑定原 Project，重新加载后才能写入新 Project";
    }
});

/** 稳定选择键：忽略数组偶然顺序，只比较规范化后的集合。 */
function selectionKeys(input: TextToImageProjectSendData): string {
    const parsed = TextToImageProjectSendDataSchema.parse(input);
    const lorebook = [...new Set(parsed.lorebookPaths.map((item) => item.replaceAll("\\", "/").replace(/^\.\//u, "")))].sort();
    const characterSelections = parsed.characterSelections
        .map((item) => `${item.groupId ?? ""}\u0000${item.characterId}\u0000${item.visualId ?? ""}`)
        .sort();
    const outfitSelections = parsed.outfitSelections
        .map((item) => `${item.groupId ?? ""}\u0000${item.characterId}\u0000${item.visualId ?? ""}\u0000${item.name}`)
        .sort();
    return JSON.stringify({lorebook, characterSelections, outfitSelections});
}

const dirty = computed(() => selectionKeys(sendData.value) !== selectionKeys(savedSendData.value));
const selectedLorebookCount = computed(() => sendData.value.lorebookPaths.length);
const selectedCharacterCount = computed(() => sendData.value.characterSelections.length);
const selectedOutfitCount = computed(() => sendData.value.outfitSelections.length);
const saveDisabled = computed(() => saving.value || loading.value || !dirty.value);

async function load(): Promise<void> {
    if (!loadedProjectRoot.value.trim()) return;
    const token = ++loadToken.value;
    loading.value = true;
    error.value = "";
    saved.value = false;
    try {
        const result = await $fetch<SendDataResponse>("/api/text-to-image/project-send-data", {
            query: {projectRoot: loadedProjectRoot.value},
        });
        // 切换 Project 后旧响应不得覆盖新 Project 状态。
        if (token !== loadToken.value) return;
        const parsed = TextToImageProjectSendDataSchema.parse(result.sendData);
        savedSendData.value = cloneSendData(parsed);
        sendData.value = cloneSendData(parsed);
        lorebookEntries.value = result.lorebookEntries;
        characters.value = result.characters;
    } catch (cause) {
        if (token === loadToken.value) {
            error.value = resolveApiErrorMessage(cause, "加载发送数据失败");
        }
    } finally {
        if (token === loadToken.value) loading.value = false;
    }
}

async function save(): Promise<boolean> {
    if (saving.value || loading.value || !dirty.value) return !dirty.value;
    saving.value = true;
    error.value = "";
    saved.value = false;
    try {
        if (loadedProjectRoot.value !== props.projectRoot) {
            error.value = "Project 已切换；当前编辑仍绑定原 Project，请重新加载后再保存";
            return false;
        }
        const result = await $fetch<{sendData: TextToImageProjectSendData}>("/api/text-to-image/project-send-data", {
            method: "PUT",
            body: {projectRoot: loadedProjectRoot.value, sendData: sendData.value},
        });
        const parsed = TextToImageProjectSendDataSchema.parse(result.sendData);
        savedSendData.value = cloneSendData(parsed);
        sendData.value = cloneSendData(parsed);
        saved.value = true;
        return true;
    } catch (cause) {
        // 保存失败保留编辑状态，允许重试。
        error.value = resolveApiErrorMessage(cause, "保存发送数据失败");
        return false;
    } finally {
        saving.value = false;
    }
}

function discard(): void {
    sendData.value = cloneSendData(savedSendData.value);
}

const leaveGuard = useUnsavedGuard({
    hasUnsavedChanges: () => dirty.value && !loading.value,
    save,
    discard,
});

defineExpose({
    guard: leaveGuard.guard,
});

function toggleLorebook(relativePath: string): void {
    sendData.value.lorebookPaths = toggleValue(sendData.value.lorebookPaths, relativePath);
}

function toggleCharacter(characterId: string, groupId: string | null, visualId: string): void {
    const characterItem = characters.value.find((item) => item.characterId === characterId && item.groupId === groupId && item.visualId === visualId);
    if (!characterItem) return;
    const selection = {characterId, groupId: characterItem.groupId, visualId: characterItem.visualId};
    const exists = sendData.value.characterSelections.some((item) => (
        item.characterId === selection.characterId && item.groupId === selection.groupId && item.visualId === selection.visualId
    ));
    sendData.value.characterSelections = exists
        ? sendData.value.characterSelections.filter((item) => (
            item.characterId !== selection.characterId || item.groupId !== selection.groupId || item.visualId !== selection.visualId
        ))
        : [...sendData.value.characterSelections, selection];
    sendData.value.characterIds = [...new Set(sendData.value.characterSelections.map((item) => item.characterId))];
}

function toggleOutfit(characterId: string, name: string, groupId: string | null, visualId: string): void {
    const characterItem = characters.value.find((item) => item.characterId === characterId && item.groupId === groupId && item.visualId === visualId);
    const exists = sendData.value.outfitSelections.some((item) => item.characterId === characterId && item.groupId === groupId && item.visualId === visualId && item.name === name);
    sendData.value.outfitSelections = exists
        ? sendData.value.outfitSelections.filter((item) => !(item.characterId === characterId && item.groupId === groupId && item.visualId === visualId && item.name === name))
        : [...sendData.value.outfitSelections, {characterId, groupId: characterItem?.groupId ?? groupId, visualId, name}];
}

function toggleValue(values: string[], value: string): string[] {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function isOutfitSelected(characterId: string, name: string, groupId: string | null, visualId: string): boolean {
    return sendData.value.outfitSelections.some((item) => item.characterId === characterId && item.groupId === groupId && item.visualId === visualId && item.name === name);
}

function isCharacterSelected(characterId: string, groupId: string | null, visualId: string): boolean {
    return sendData.value.characterSelections.some((item) => item.characterId === characterId && item.groupId === groupId && item.visualId === visualId);
}

function isLorebookSelected(relativePath: string): boolean {
    return sendData.value.lorebookPaths.includes(relativePath);
}

function cloneSendData(input: TextToImageProjectSendData): TextToImageProjectSendData {
    return TextToImageProjectSendDataSchema.parse(JSON.parse(JSON.stringify(input)) as unknown);
}
</script>

<template>
    <section class="flex h-full min-h-0 flex-col">
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-color)] px-5 py-4">
            <div>
                <h3 class="text-[18px] font-semibold text-[var(--text-main)]">发送数据</h3>
                <p class="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">“启用角色分组”负责正文自动扫描；本页负责无条件固定发送。勾选后必须保存，下一次请求才会使用；请求开始时由后端冻结内容。</p>
            </div>
            <button class="rounded-md bg-[var(--accent-main)] px-3 py-2 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saveDisabled" @click="save">
                {{ saving ? "保存中…" : "保存选择" }}
            </button>
        </header>

        <div class="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-5">
            <p v-if="dirty" class="mb-4 rounded-md border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-[13px] text-[var(--warning-text)]">有未保存更改，尚不会发送给 LLM</p>
            <p v-if="loading" class="text-[13px] text-[var(--text-muted)]">加载中…</p>
            <p v-else-if="error" class="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger-text)]">{{ error }}</p>
            <div v-else class="grid gap-5 xl:grid-cols-3">
                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">Lorebook 条目 <span class="text-[13px] font-normal text-[var(--text-secondary)]">已选 {{ selectedLorebookCount }} / {{ lorebookEntries.length }}</span></h4>
                    <div v-if="lorebookEntries.length === 0" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有可发送条目。</div>
                    <button
                        v-for="entry in lorebookEntries"
                        :key="entry.path"
                        type="button"
                        role="checkbox"
                        :aria-checked="isLorebookSelected(entry.path)"
                        class="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px]"
                        :class="isLorebookSelected(entry.path) ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'"
                        @click="toggleLorebook(entry.path)"
                    >
                        <span class="i-lucide-check h-4 w-4 shrink-0" :class="isLorebookSelected(entry.path) ? 'text-[var(--accent-text)]' : 'opacity-0'"></span>
                        <span class="min-w-0 flex-1"><span class="block truncate text-[var(--text-main)]">{{ entry.title }}</span><span class="block truncate text-[11px] text-[var(--text-muted)]">{{ entry.path }}</span></span>
                        <span v-if="isLorebookSelected(entry.path)" class="shrink-0 rounded bg-[var(--accent-main)] px-1.5 py-0.5 text-[11px] text-[var(--text-inverse)]">固定发送</span>
                        <span v-else class="shrink-0 text-[11px] text-[var(--text-muted)]">未固定发送</span>
                    </button>
                </div>

                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">角色固定发送列表 <span class="text-[13px] font-normal text-[var(--text-secondary)]">已选 {{ selectedCharacterCount }} / {{ characters.length }}</span></h4>
                    <div v-if="characters.length === 0" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有视觉角色资料。</div>
                    <button
                        v-for="characterItem in characters"
                        :key="`${characterItem.groupId ?? 'legacy'}-${characterItem.characterId}-${characterItem.visualId}`"
                        type="button"
                        role="checkbox"
                        :aria-checked="isCharacterSelected(characterItem.characterId, characterItem.groupId, characterItem.visualId)"
                        class="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px]"
                        :class="isCharacterSelected(characterItem.characterId, characterItem.groupId, characterItem.visualId) ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'"
                        @click="toggleCharacter(characterItem.characterId, characterItem.groupId, characterItem.visualId)"
                    >
                        <span class="i-lucide-check h-4 w-4 shrink-0" :class="isCharacterSelected(characterItem.characterId, characterItem.groupId, characterItem.visualId) ? 'text-[var(--accent-text)]' : 'opacity-0'"></span>
                        <span class="min-w-0 flex-1"><span class="block truncate text-[var(--text-main)]">{{ characterItem.cnName || characterItem.enName || characterItem.characterId }}</span><span class="block truncate text-[11px] text-[var(--text-muted)]">{{ characterItem.groupId ?? "旧版" }} · {{ characterItem.visualId.slice(0, 8) }}</span></span>
                        <span v-if="isCharacterSelected(characterItem.characterId, characterItem.groupId, characterItem.visualId)" class="shrink-0 rounded bg-[var(--accent-main)] px-1.5 py-0.5 text-[11px] text-[var(--text-inverse)]">固定发送</span>
                        <span v-else class="shrink-0 text-[11px] text-[var(--text-muted)]">未固定发送</span>
                    </button>
                </div>

                <div class="rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-4">
                    <h4 class="mb-3 text-[15px] font-semibold text-[var(--text-main)]">独立服装列表 <span class="text-[13px] font-normal text-[var(--text-secondary)]">已选 {{ selectedOutfitCount }}</span></h4>
                    <div v-if="characters.every((item) => item.outfits.length === 0)" class="text-[13px] text-[var(--text-muted)]">当前 Project 没有可发送服装。</div>
                    <template v-for="characterItem in characters" :key="`${characterItem.groupId ?? 'legacy'}-${characterItem.characterId}-${characterItem.visualId}-outfits`">
                        <p v-if="characterItem.outfits.length > 0" class="mb-1 mt-3 text-[12px] text-[var(--text-muted)]">{{ characterItem.cnName || characterItem.enName || characterItem.characterId }}</p>
                        <button
                            v-for="outfit in characterItem.outfits"
                            :key="`${characterItem.characterId}-${characterItem.visualId}-${outfit.name}`"
                            type="button"
                            role="checkbox"
                            :aria-checked="isOutfitSelected(characterItem.characterId, outfit.name, characterItem.groupId, characterItem.visualId)"
                            class="mb-2 flex w-full cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px]"
                            :class="isOutfitSelected(characterItem.characterId, outfit.name, characterItem.groupId, characterItem.visualId) ? 'border-[var(--border-accent)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'"
                            @click="toggleOutfit(characterItem.characterId, outfit.name, characterItem.groupId, characterItem.visualId)"
                        >
                            <span class="i-lucide-check h-4 w-4 shrink-0" :class="isOutfitSelected(characterItem.characterId, outfit.name, characterItem.groupId, characterItem.visualId) ? 'text-[var(--accent-text)]' : 'opacity-0'"></span>
                            <span class="min-w-0 flex-1 truncate text-[var(--text-main)]">{{ outfit.cnName || outfit.enName }}</span>
                            <span v-if="isOutfitSelected(characterItem.characterId, outfit.name, characterItem.groupId, characterItem.visualId)" class="shrink-0 rounded bg-[var(--accent-main)] px-1.5 py-0.5 text-[11px] text-[var(--text-inverse)]">固定发送服装</span>
                            <span v-else class="shrink-0 text-[11px] text-[var(--text-muted)]">未固定发送</span>
                        </button>
                    </template>
                </div>
            </div>
        </div>
        <p v-if="saved" class="border-t border-[var(--border-color)] px-5 py-2 text-[13px] text-[var(--success-text)]">发送数据已保存，下一次请求会使用已保存的选择。</p>

        <div v-if="leaveGuard.pendingMessage.value" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div class="w-full max-w-md rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-5 shadow-xl">
                <h3 class="text-[16px] font-semibold text-[var(--text-main)]">有未保存的发送数据</h3>
                <p class="mt-2 text-[13px] text-[var(--text-secondary)]">{{ leaveGuard.pendingMessage.value }}</p>
                <div class="mt-4 flex flex-wrap justify-end gap-2">
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="leaveGuard.chooseCancel">取消</button>
                    <button class="h-9 rounded-md border border-[var(--border-color)] px-3 text-[13px] text-[var(--text-secondary)]" :disabled="saving" @click="leaveGuard.chooseDiscard">放弃</button>
                    <button class="h-9 rounded-md bg-[var(--accent-main)] px-3 text-[13px] font-medium text-[var(--text-inverse)] disabled:opacity-50" :disabled="saving" @click="leaveGuard.chooseSave">{{ saving ? "保存中…" : "保存" }}</button>
                </div>
            </div>
        </div>
    </section>
</template>
