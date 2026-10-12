<script setup lang="ts">
/**
 * 设置窗口“作品”分区的页面（同名 .md）：作品目录一行，“更改…”打开书架同一个目录选择器，选定后写进用户层
 * （docs/specs/workbench/bookshelf.md 输出 18）。
 */
import {Button} from "@notnotype/nb-ui/components";
import {ref} from "vue";

import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import type {SettingLayer, SettingsFailure, SettingsService} from "nbook/shared/settings";
import SettingsRow from "nbook/ui/settings/SettingsRow.vue";

import {librarySetting} from "../../shared/contracts";
import PathPickerDialog from "./PathPickerDialog.vue";
import type {PathPickerSource} from "./PathPickerDialog.vue";

defineOptions({name: "WorksSettingsPage"});

const props = defineProps<{
    /** 设置窗口当前的标签（`context.layer`）：这个分区只在“用户”标签下可用。 */
    layer: SettingLayer;
    settings: SettingsService;
    source: PathPickerSource;
    locale: DisplayLocale;
}>();

const emit = defineEmits<{
    (event: "write-failed", failure: {readonly code: SettingsFailure; readonly detail: string}): void;
}>();

const TEXT = {
    change: {"zh-CN": "更改…", "en-US": "Change…"},
    unset: {"zh-CN": "还没设，第一次新建作品时会记下", "en-US": "Not set yet; it is remembered when you create your first book"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

const picking = ref(false);
/** 这次选定、还在写的目录：写入结算之前显示它，结算后回到层里的值。 */
const pending = ref<string | null>(null);

function shown(value: unknown): string {
    return pending.value ?? (typeof value === "string" ? value : "");
}

async function pick(path: string): Promise<void> {
    picking.value = false;
    pending.value = path;
    try {
        // 作品目录只允许用户层（分区声明 layers: ["user"]）：写用户层，不跟随别的标签。
        const result = await props.settings.update(librarySetting, path, {layer: "user"});
        if (!result.ok) emit("write-failed", {code: result.code, detail: result.detail});
    } finally {
        pending.value = null;
    }
}
</script>

<template>
    <div class="works-settings" data-works-settings>
        <SettingsRow
            v-slot="row"
            :settings="settings"
            :setting="librarySetting"
            :layer="layer"
            :locale="locale"
            @write-failed="(failure) => emit('write-failed', {code: failure.code, detail: failure.detail})"
        >
            <span v-if="shown(row.value) !== ''" class="works-settings__path" data-works-library>{{ shown(row.value) }}</span>
            <span v-else class="works-settings__unset" data-works-library data-works-library-empty>{{ text(TEXT.unset) }}</span>
            <Button
                :id="row.id"
                variant="secondary"
                size="sm"
                :disabled="row.disabled || pending !== null"
                data-works-library-change
                @click="picking = true"
            >{{ text(TEXT.change) }}</Button>
            <!-- 选择器在行的插槽里：模态对话框叠在设置窗口之上，关闭时焦点回到“更改…”。 -->
            <PathPickerDialog
                :locale="locale"
                :open="picking"
                mode="directory"
                :source="source"
                :initial-path="shown(row.value) === '' ? null : shown(row.value)"
                @pick="pick"
                @cancel="picking = false"
            />
        </SettingsRow>
    </div>
</template>

<style scoped>
.works-settings {
    display: flex;
    flex-direction: column;
}

/* 与单行输入同宽（settings-window.md 输出 9）：长路径在任意处折行，不撑破行。 */
.works-settings__path,
.works-settings__unset {
    max-width: 320px;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    overflow-wrap: anywhere;
}

.works-settings__path {
    font-family: var(--font-mono);
    color: var(--text-secondary);
}

.works-settings__unset {
    color: var(--text-muted);
}
</style>
