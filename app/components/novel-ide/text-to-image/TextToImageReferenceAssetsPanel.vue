<script setup lang="ts">
/**
 * P5 参考资源面板：上传/列出 Project 参考资产，并把 Vibe / Character Reference / Inpaint
 * 蒙版绑定到 Recipe references。所有选择只持久 contentHash + strength + informationExtracted，
 * 不在浏览器存 bytes/Data URL；保存时经 store.saveRecipe 写入 Recipe 真相源。
 */
import {computed, ref, watch} from "vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useTextToImageStore} from "nbook/app/stores/text-to-image";
import type {TextToImageReferenceAssetDto} from "nbook/shared/text-to-image-reference-asset";

const props = defineProps<{projectPath: string}>();

const store = useTextToImageStore();
const notification = useNotification();

const assets = ref<TextToImageReferenceAssetDto[]>([]);
const loading = ref(false);
const uploading = ref(false);
const saving = ref(false);

/** 仅展示 source-image（vibe-encoding 为派生产物，不在 UI 选择）。 */
const sourceImages = computed(() => assets.value.filter((asset) => asset.kind === "source-image"));

const references = computed(() => store.recipeReferences);

/** 资产标识：取 contentHash 前 8 位，便于在 UI 区分。 */
function shortHash(hash: string): string {
    return hash.slice(0, 8);
}

async function loadAssets(): Promise<void> {
    if (!props.projectPath) return;
    loading.value = true;
    try {
        assets.value = await $fetch<TextToImageReferenceAssetDto[]>("/api/text-to-image/reference-assets", {
            params: {projectPath: props.projectPath},
        });
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "读取参考资产失败"));
    } finally {
        loading.value = false;
    }
}

/** 上传参考资产；服务端做内容寻址去重，同内容返回既有资产。 */
async function uploadAsset(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading.value = true;
    try {
        const form = new FormData();
        form.append("file", file);
        const created = await $fetch<TextToImageReferenceAssetDto>("/api/text-to-image/reference-assets", {
            method: "POST",
            params: {projectPath: props.projectPath},
            body: form,
        });
        if (!assets.value.some((asset) => asset.id === created.id)) {
            assets.value = [...assets.value, created];
        }
        notification.success(`已上传参考资产 ${shortHash(created.contentHash)}`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "上传参考资产失败"));
    } finally {
        uploading.value = false;
        input.value = "";
    }
}

async function deleteAsset(id: string): Promise<void> {
    // 将 URL 先显式收收为 string，绕过 Nuxt 对 `/reference-assets/:id.content` 点路由的 $fetch 路由类型匹配偏差。
    const url: string = `/api/text-to-image/reference-assets/${encodeURIComponent(id)}`;
    try {
        await $fetch(url, {
            method: "DELETE",
            body: {projectPath: props.projectPath},
        });
        assets.value = assets.value.filter((asset) => asset.id !== id);
        notification.success("已删除参考资产");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除参考资产失败"));
    }
}

/** 把资产绑定到 Vibe 槽（最多 16）。 */
function addVibe(asset: TextToImageReferenceAssetDto): void {
    if (references.value.vibeReferences.length >= 16) {
        notification.warning("Vibe 引用已达上限 16 条");
        return;
    }
    if (references.value.vibeReferences.some((item) => item.contentHash === asset.contentHash)) {
        notification.info("该资产已在 Vibe 列表中");
        return;
    }
    store.addVibeReference(asset.contentHash, 0.6, 0.5);
}

function updateVibeStrength(index: number, strength: number): void {
    store.updateVibeReference(index, {strength});
}

function updateVibeInfo(index: number, informationExtracted: number): void {
    store.updateVibeReference(index, {informationExtracted});
}

/** 把资产绑定到 Character Reference 槽（最多 1）。 */
function setCharacter(asset: TextToImageReferenceAssetDto): void {
    store.setCharacterReference(asset.contentHash, 0.4);
}

/** 把资产绑定到 Inpaint 蒙版槽。 */
function setInpaint(asset: TextToImageReferenceAssetDto): void {
    store.setInpaintMask(asset.contentHash);
}

async function saveRecipe(): Promise<void> {
    saving.value = true;
    try {
        await store.saveRecipe(props.projectPath);
        notification.success("已保存 Recipe 参考资产");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "保存 Recipe 失败"));
    } finally {
        saving.value = false;
    }
}

watch(() => props.projectPath, loadAssets, {immediate: true});
</script>

<template>
    <!-- P5 参考资产：内容寻址上传 + Vibe/CharRef/Inpaint 槽位绑定 -->
    <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)]">
                <span>上传参考资产</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" :disabled="uploading" @change="uploadAsset" />
            </label>
            <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)]" :disabled="loading" @click="loadAssets">刷新</button>
            <button type="button" class="ml-auto rounded-md border border-[var(--border-accent)] bg-[var(--accent-bg)] px-2.5 py-1 text-xs text-[var(--accent-text)] hover:opacity-80" :disabled="saving || !store.recipeDirty" @click="saveRecipe">保存 Recipe</button>
        </div>

        <!-- 资产列表 -->
        <div v-if="loading" class="text-xs text-[var(--text-muted)]">读取中…</div>
        <div v-else-if="sourceImages.length === 0" class="text-xs text-[var(--text-muted)]">尚无参考资产，上传后将按内容寻址去重。</div>
        <ul v-else class="flex flex-col gap-1.5">
            <li v-for="asset in sourceImages" :key="asset.id" class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 px-2 py-1.5">
                <img :src="`/api/text-to-image/reference-assets/${asset.id}/content?projectPath=${encodeURIComponent(props.projectPath)}`" class="h-10 w-10 rounded object-cover" alt="" />
                <span class="font-mono text-[10px] text-[var(--text-muted)]">{{ shortHash(asset.contentHash) }}</span>
                <span class="text-[10px] text-[var(--text-muted)]">{{ asset.mimeType }}</span>
                <div class="ml-auto flex items-center gap-1">
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="addVibe(asset)">+Vibe</button>
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="setCharacter(asset)">CharRef</button>
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="setInpaint(asset)">Inpaint</button>
                    <button type="button" class="rounded border border-[var(--border-danger)] px-1.5 py-0.5 text-[10px] text-[var(--danger-text)] hover:opacity-80" @click="deleteAsset(asset.id)">删</button>
                </div>
            </li>
        </ul>

        <!-- Vibe 槽位 -->
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-2">
            <div class="mb-1.5 flex items-center gap-2">
                <span class="text-xs font-semibold text-[var(--text-primary)]">Vibe Transfer</span>
                <label class="ml-auto flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    归一化强度
                    <input type="checkbox" :checked="references.normalizeVibeStrengths" @change="store.setNormalizeVibeStrengths(($event.target as HTMLInputElement).checked)" />
                </label>
            </div>
            <div v-if="references.vibeReferences.length === 0" class="text-[10px] text-[var(--text-muted)]">未绑定 Vibe 引用。</div>
            <ul v-else class="flex flex-col gap-1.5">
                <li v-for="(item, index) in references.vibeReferences" :key="index" class="flex flex-wrap items-center gap-2 text-[10px]">
                    <span class="font-mono text-[var(--text-muted)]">{{ shortHash(item.contentHash) }}</span>
                    <label class="flex items-center gap-1 text-[var(--text-secondary)]">强度
                        <input type="number" min="0" max="1" step="0.05" :value="item.strength" class="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1 py-0.5 text-[10px]" @input="updateVibeStrength(index, Number(($event.target as HTMLInputElement).value))" />
                    </label>
                    <label class="flex items-center gap-1 text-[var(--text-secondary)]">信息提取
                        <input type="number" min="0" max="1" step="0.05" :value="item.informationExtracted ?? 0" class="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1 py-0.5 text-[10px]" @input="updateVibeInfo(index, Number(($event.target as HTMLInputElement).value))" />
                    </label>
                    <button type="button" class="ml-auto rounded border border-[var(--border-danger)] px-1.5 py-0.5 text-[10px] text-[var(--danger-text)] hover:opacity-80" @click="store.removeVibeReference(index)">移除</button>
                </li>
            </ul>
        </div>

        <!-- Character Reference 槽位 -->
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-2">
            <div class="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">Character Reference</div>
            <div v-if="references.characterReferences.length === 0" class="text-[10px] text-[var(--text-muted)]">未绑定角色引用（最多 1 条）。</div>
            <div v-else class="flex flex-wrap items-center gap-2 text-[10px]">
                <span class="font-mono text-[var(--text-muted)]">{{ shortHash(references.characterReferences[0]!.contentHash) }}</span>
                <label class="flex items-center gap-1 text-[var(--text-secondary)]">强度
                    <input type="number" min="0" max="1" step="0.05" :value="references.characterReferences[0]!.strength" class="w-16 rounded border border-[var(--border-color)] bg-[var(--bg-input)] px-1 py-0.5 text-[10px]" @input="store.setCharacterReference(references.characterReferences[0]!.contentHash, Number(($event.target as HTMLInputElement).value))" />
                </label>
                <button type="button" class="ml-auto rounded border border-[var(--border-danger)] px-1.5 py-0.5 text-[10px] text-[var(--danger-text)] hover:opacity-80" @click="store.removeCharacterReference()">移除</button>
            </div>
        </div>

        <!-- Inpaint 蒙版槽位 -->
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-2">
            <div class="mb-1.5 text-xs font-semibold text-[var(--text-primary)]">Inpaint 蒙版</div>
            <div v-if="references.inpaint === null" class="text-[10px] text-[var(--text-muted)]">未绑定蒙版（仅 PNG）。</div>
            <div v-else class="flex flex-wrap items-center gap-2 text-[10px]">
                <span class="font-mono text-[var(--text-muted)]">{{ shortHash(references.inpaint.contentHash) }}</span>
                <button type="button" class="ml-auto rounded border border-[var(--border-danger)] px-1.5 py-0.5 text-[10px] text-[var(--danger-text)] hover:opacity-80" @click="store.removeInpaintMask()">移除</button>
            </div>
        </div>
    </div>
</template>
