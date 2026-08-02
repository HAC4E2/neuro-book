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
import {TextToImageReferenceAssetPageDtoSchema} from "nbook/shared/text-to-image-reference-asset";
import type {VibeImportResponse} from "nbook/shared/text-to-image-vibe-container";

const props = defineProps<{projectPath: string}>();

const store = useTextToImageStore();
const notification = useNotification();

const assets = ref<TextToImageReferenceAssetDto[]>([]);
const loading = ref(false);
const uploading = ref(false);
const importing = ref(false);
const saving = ref(false);
/** 最近一次 .vibe 导入返回的强度建议；只作提示，绝不直接改 Recipe。 */
const importSuggestion = ref<VibeImportResponse | null>(null);

/** 仅展示 source-image（vibe-encoding 为派生产物，不在 UI 选择）。 */
const sourceImages = computed(() => assets.value.filter((asset) => asset.kind === "source-image"));

const references = computed(() => store.recipeReferences);

/** 资产标识：取 contentHash 前 8 位，便于在 UI 区分。 */
function shortHash(hash: string): string {
    return hash.slice(0, 8);
}

/** 内容路由是 `/reference-assets/:id.content` 点路由，不是 `/:id/content` 子路径。 */
function assetContentUrl(assetId: string): string {
    return `/api/text-to-image/reference-assets/${encodeURIComponent(assetId)}.content?projectPath=${encodeURIComponent(props.projectPath)}`;
}

async function loadAssets(): Promise<void> {
    if (!props.projectPath) return;
    loading.value = true;
    try {
        // 服务端返回 strict page DTO；只取 items，绝不把 page 对象当数组用。
        const parsed = TextToImageReferenceAssetPageDtoSchema.parse(await $fetch(
            "/api/text-to-image/reference-assets",
            {params: {projectPath: props.projectPath}},
        ));
        assets.value = parsed.items;
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "读取参考资产失败"));
    } finally {
        loading.value = false;
    }
}

/**
 * 上传参考图片；服务端做内容寻址去重，同内容返回既有资产。
 * projectPath 与 kind 必须作为 multipart 字段随表单发送——服务端只从 form parts 读取，不读 query。
 */
async function uploadAsset(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    if (files.length === 0) return;
    uploading.value = true;
    try {
        for (const file of files) {
            const form = new FormData();
            form.append("projectPath", props.projectPath);
            form.append("kind", "source-image");
            form.append("file", file);
            const created = await $fetch<TextToImageReferenceAssetDto>("/api/text-to-image/reference-assets", {
                method: "POST",
                body: form,
            });
            if (!assets.value.some((asset) => asset.id === created.id)) {
                assets.value = [...assets.value, created];
            }
        }
        notification.success(files.length > 1 ? `已上传 ${files.length} 张参考图片` : "已上传参考图片");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "上传参考图片失败"));
    } finally {
        uploading.value = false;
        input.value = "";
    }
}

/**
 * 导入 `.vibe` / `.naiv4vibe` 容器（all-or-nothing）；返回的 suggestedStrength 只是建议，
 * 绝不直接改 Recipe——用户显式点击 +Vibe 后才绑定。
 */
async function importVibeContainer(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    if (files.length === 0) return;
    importing.value = true;
    importSuggestion.value = null;
    try {
        for (const file of files) {
            const form = new FormData();
            form.append("projectPath", props.projectPath);
            form.append("file", file);
            const result = await $fetch<VibeImportResponse>("/api/text-to-image/reference-assets/import-vibe", {
                method: "POST",
                body: form,
            });
            importSuggestion.value = result;
            if (!assets.value.some((asset) => asset.contentHash === result.sourceContentHash)) {
                await loadAssets();
            }
        }
        notification.success(`已导入 ${files.length} 个 Vibe 容器`);
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "导入 Vibe 容器失败"));
    } finally {
        importing.value = false;
        input.value = "";
    }
}

/** 把导入的 Vibe 源绑定到 Vibe 槽（以服务端建议强度为默认值）。 */
function bindImportedVibe(): void {
    const suggestion = importSuggestion.value;
    if (!suggestion) return;
    if (references.value.vibeReferences.some((item: {contentHash: string}) => item.contentHash === suggestion.sourceContentHash)) {
        notification.info("该资产已在 Vibe 列表中");
        return;
    }
    store.addVibeReference(suggestion.sourceContentHash, suggestion.suggestedStrength, 0.5);
    notification.success(`已绑定 Vibe（建议强度 ${suggestion.suggestedStrength}）`);
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
    if (references.value.vibeReferences.some((item: {contentHash: string}) => item.contentHash === asset.contentHash)) {
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

/** 把资产绑定到 Inpaint 底图槽位（base image）。 */
function chooseInpaintBase(asset: TextToImageReferenceAssetDto): void {
    inpaintBaseHash.value = asset.contentHash;
    commitInpaint();
}

/** 把资产绑定到 Inpaint 蒙版槽位（仅 PNG）。 */
function chooseInpaintMask(asset: TextToImageReferenceAssetDto): void {
    if (asset.mimeType !== "image/png") {
        notification.warning("Inpaint 蒙版必须是 PNG");
        return;
    }
    inpaintMaskHash.value = asset.contentHash;
    commitInpaint();
}

/** Inpaint 双槽位都有效才写入 Recipe；否则保持未完成提示。 */
function commitInpaint(): void {
    if (inpaintBaseHash.value && inpaintMaskHash.value) {
        store.setInpaint({baseImageContentHash: inpaintBaseHash.value, maskContentHash: inpaintMaskHash.value});
    } else if (!inpaintBaseHash.value && !inpaintMaskHash.value) {
        store.removeInpaint();
    }
}

/** 清空 Inpaint 双槽位。 */
function removeInpaint(): void {
    inpaintBaseHash.value = null;
    inpaintMaskHash.value = null;
    store.removeInpaint();
}

/** Inpaint base/mask 的未提交选择；从已保存 Recipe 初始化。 */
const inpaintBaseHash = ref<string | null>(references.value.inpaint?.baseImageContentHash ?? null);
const inpaintMaskHash = ref<string | null>(references.value.inpaint?.maskContentHash ?? null);

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
            <label class="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)]" :class="uploading || !props.projectPath ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'">
                <span class="h-3.5 w-3.5" :class="uploading ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-image-plus'"></span>
                <span>{{ uploading ? "上传中…" : "上传参考图片" }}</span>
                <input type="file" accept="image/png,image/jpeg" multiple class="hidden" :disabled="uploading || !props.projectPath" @change="uploadAsset" />
            </label>
            <label class="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)]" :class="importing || !props.projectPath ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'">
                <span class="h-3.5 w-3.5" :class="importing ? 'i-lucide-loader-2 animate-spin' : 'i-lucide-package-open'"></span>
                <span>{{ importing ? "导入中…" : "导入 .vibe 容器" }}</span>
                <input type="file" accept=".vibe,.naiv4vibe" multiple class="hidden" :disabled="importing || !props.projectPath" @change="importVibeContainer" />
            </label>
            <button type="button" class="rounded-md border border-[var(--border-color)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:border-[var(--border-accent)]" :disabled="loading" @click="loadAssets">刷新</button>
            <button type="button" class="ml-auto rounded-md border border-[var(--border-accent)] bg-[var(--accent-bg)] px-2.5 py-1 text-xs text-[var(--accent-text)] hover:opacity-80 disabled:opacity-50" :disabled="saving || !store.recipeDirty" @click="saveRecipe">保存 Recipe</button>
        </div>
        <p class="m-0 text-[10px] text-[var(--text-muted)]">上传图片后，用下方 <span class="text-[var(--text-secondary)]">+Vibe</span> / <span class="text-[var(--text-secondary)]">CharRef</span> / <span class="text-[var(--text-secondary)]">Inpaint</span> 绑定到对应槽位；Vibe 编码在首次生图时由服务端自动派生并缓存，无需手动上传。<span class="text-[var(--text-secondary)]">.vibe</span> 容器导入后仅提示建议强度，点 <span class="text-[var(--text-secondary)]">+Vibe</span> 才写入 Recipe。</p>

        <!-- Vibe 导入建议（只读提示，不改 Recipe） -->
        <div v-if="importSuggestion" class="rounded-md border border-[var(--border-info)] bg-[var(--bg-input)]/40 px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
            <span class="font-mono">{{ shortHash(importSuggestion.sourceContentHash) }}</span>
            <span> 已导入：{{ importSuggestion.sourceWidth }}×{{ importSuggestion.sourceHeight }}，{{ importSuggestion.encodingCount }} 个编码</span>
            <span class="ml-1 text-[var(--text-muted)]">建议强度 {{ importSuggestion.suggestedStrength }}</span>
            <button type="button" class="ml-2 rounded border border-[var(--border-accent)] px-1.5 py-0.5 text-[10px] text-[var(--accent-text)] hover:opacity-80" @click="bindImportedVibe">+Vibe</button>
        </div>

        <!-- 资产列表 -->
        <div v-if="!props.projectPath" class="text-xs text-[var(--text-muted)]">请先打开一个小说 Project。</div>
        <div v-else-if="loading" class="text-xs text-[var(--text-muted)]">读取中…</div>
        <div v-else-if="sourceImages.length === 0" class="text-xs text-[var(--text-muted)]">尚无参考图片，上传后将按内容寻址去重。</div>
        <ul v-else class="flex flex-col gap-1.5">
            <li v-for="asset in sourceImages" :key="asset.id" class="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/45 px-2 py-1.5">
                <img :src="assetContentUrl(asset.id)" class="h-10 w-10 rounded object-cover" alt="" />
                <span class="font-mono text-[10px] text-[var(--text-muted)]">{{ shortHash(asset.contentHash) }}</span>
                <span class="text-[10px] text-[var(--text-muted)]">{{ asset.mimeType }} · {{ asset.width }}×{{ asset.height }}</span>
                <span v-if="asset.status === 'missing'" class="text-[10px] text-[var(--text-warning)]">文件缺失</span>
                <span v-else-if="asset.status === 'tampered'" class="text-[10px] text-[var(--danger-text)]">已篡改</span>
                <div class="ml-auto flex items-center gap-1">
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="addVibe(asset)">+Vibe</button>
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="setCharacter(asset)">CharRef</button>
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="chooseInpaintBase(asset)">底图</button>
                    <button type="button" class="rounded border border-[var(--border-color)] px-1.5 py-0.5 text-[10px] hover:border-[var(--border-accent)]" @click="chooseInpaintMask(asset)">蒙版</button>
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

        <!-- Inpaint 双资产槽位 -->
        <div class="rounded-md border border-[var(--border-color)] bg-[var(--bg-input)]/30 p-2">
            <div class="mb-1.5 flex items-center gap-2 text-xs font-semibold text-[var(--text-primary)]">
                Inpaint
                <span class="text-[10px] font-normal text-[var(--text-muted)]">底图（PNG/JPEG）+ 蒙版（仅 PNG，同尺寸）</span>
            </div>
            <div class="flex flex-col gap-1.5 text-[10px]">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[var(--text-secondary)]">底图：</span>
                    <span v-if="inpaintBaseHash" class="font-mono text-[var(--text-muted)]">{{ shortHash(inpaintBaseHash) }}</span>
                    <span v-else class="text-[var(--text-muted)]">未选择</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[var(--text-secondary)]">蒙版：</span>
                    <span v-if="inpaintMaskHash" class="font-mono text-[var(--text-muted)]">{{ shortHash(inpaintMaskHash) }}</span>
                    <span v-else class="text-[var(--text-muted)]">未选择</span>
                </div>
                <div v-if="inpaintBaseHash && inpaintMaskHash" class="text-[var(--text-muted)]">双图已绑定，保存 Recipe 后生效。</div>
                <div v-else class="text-[var(--text-warning)]">底图与蒙版都选择后才可保存 Inpaint 引用。</div>
                <button type="button" class="ml-auto rounded border border-[var(--border-danger)] px-1.5 py-0.5 text-[10px] text-[var(--danger-text)] hover:opacity-80" @click="removeInpaint">移除</button>
            </div>
        </div>
    </div>
</template>
