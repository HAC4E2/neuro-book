<script setup lang="ts">
import {computed, ref, watch} from "vue";
import FormInput from "nbook/app/components/common/form/FormInput.vue";
import FormSelect, {type SelectOption} from "nbook/app/components/common/form/FormSelect.vue";
import IconButton from "nbook/app/components/common/IconButton.vue";
import {useNotification} from "nbook/app/composables/useNotification";
import {useTextToImageStore} from "nbook/app/stores/text-to-image";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

const store = useTextToImageStore();
const notification = useNotification();
const selectedId = ref<number | null>(null);
const busy = ref(false);
const name = ref("");
const baseUrl = ref("https://api.openai.com/v1");
const model = ref("");
const credential = ref("");
const allowPrivateNetwork = ref(false);

const options = computed<SelectOption[]>(() => store.providers
    .filter((provider) => provider.kind === "openai_compatible")
    .map((provider) => ({value: String(provider.id), label: `${provider.name} · ${provider.model}`})));

watch(selectedId, (id) => {
    const provider = store.providers.find((item) => item.id === id && item.kind === "openai_compatible");
    if (!provider) {
        return;
    }
    name.value = provider.name;
    baseUrl.value = provider.baseUrl;
    model.value = provider.model;
    allowPrivateNetwork.value = provider.settings.allowPrivateNetwork;
    credential.value = "";
});

function newProvider(): void {
    selectedId.value = null;
    name.value = "";
    baseUrl.value = "https://api.openai.com/v1";
    model.value = "";
    credential.value = "";
    allowPrivateNetwork.value = false;
}

/** 保存 Provider；credential 仅用于本次网络请求，并在 finally 中清空。 */
async function save(): Promise<void> {
    if (busy.value || !name.value.trim() || !baseUrl.value.trim() || !model.value.trim()) {
        return;
    }
    if (selectedId.value === null && !credential.value.trim()) {
        notification.warning("新建 Provider 时需要填写凭据");
        return;
    }
    busy.value = true;
    const body = {
        kind: "openai_compatible" as const,
        name: name.value.trim(),
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        settings: {allowPrivateNetwork: allowPrivateNetwork.value, requestIntervalMs: 0},
        ...(credential.value.trim() ? {credential: credential.value.trim()} : {}),
    };
    try {
        const provider = selectedId.value === null
            ? await $fetch<{id: number}>("/api/text-to-image/providers", {method: "POST", body: {...body, credential: credential.value.trim()}})
            : await $fetch<{id: number}>(`/api/text-to-image/providers/${selectedId.value}`, {method: "PATCH", body});
        selectedId.value = provider.id;
        await store.refreshProviders();
        notification.success("Provider 已保存");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "保存 Provider 失败"));
    } finally {
        credential.value = "";
        busy.value = false;
    }
}

async function remove(): Promise<void> {
    if (selectedId.value === null || busy.value) {
        return;
    }
    busy.value = true;
    try {
        await $fetch(`/api/text-to-image/providers/${selectedId.value}`, {method: "DELETE"});
        newProvider();
        await store.refreshProviders();
        notification.success("Provider 已删除");
    } catch (error) {
        notification.error(resolveApiErrorMessage(error, "删除 Provider 失败"));
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <section class="space-y-3 border border-[var(--border-color)] bg-[var(--bg-panel)]/45 p-4">
        <!-- Provider 配置 -->
        <div class="flex items-center justify-between gap-3">
            <h2 class="flex items-center gap-2 text-lg font-semibold text-[var(--accent-text)]"><span class="i-lucide-server-cog h-5 w-5"></span>Provider</h2>
            <div class="flex items-center gap-1"><IconButton title="新建 Provider" size="sm" :disabled="busy" @click="newProvider"><span class="i-lucide-plus h-4 w-4"></span></IconButton><IconButton title="删除 Provider" size="sm" :disabled="busy || selectedId === null" @click="void remove"><span class="i-lucide-trash-2 h-4 w-4 text-[var(--danger-text)]"></span></IconButton></div>
        </div>
        <FormSelect :model-value="selectedId === null ? '' : String(selectedId)" :options="options" placeholder="新建 OpenAI-compatible Provider" dropdown-direction="down" @update:model-value="selectedId = $event ? Number($event) : null" />
        <div class="grid gap-3 md:grid-cols-2"><label class="block"><span class="field-label">名称</span><FormInput :model-value="name" @update:model-value="name = $event" /></label><label class="block"><span class="field-label">模型</span><FormInput :model-value="model" @update:model-value="model = $event" /></label></div>
        <label class="block"><span class="field-label">Base URL</span><FormInput :model-value="baseUrl" @update:model-value="baseUrl = $event" /></label>
        <label class="block"><span class="field-label">凭据</span><FormInput :model-value="credential" type="password" placeholder="新建必填；保留现有凭据时可留空" @update:model-value="credential = $event" /></label>
        <label class="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><input :checked="allowPrivateNetwork" type="checkbox" class="h-4 w-4" @change="allowPrivateNetwork = ($event.target as HTMLInputElement).checked"><span>允许私有网络地址</span></label>
        <button type="button" class="h-9 border border-[var(--accent-main)] px-3 text-sm text-[var(--accent-text)] hover:bg-[var(--accent-bg)] disabled:opacity-60" :disabled="busy" @click="void save">{{ busy ? "保存中" : "保存 Provider" }}</button>
    </section>
</template>
