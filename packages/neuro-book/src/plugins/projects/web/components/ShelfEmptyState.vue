<script setup lang="ts">
/** 空书架的引导卡（同名 .md）：看板娘、一句说明作品是什么、新作品会放在哪，以及两个入口。 */
import {Button} from "@notnotype/nb-ui/components";
import {computed} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";
import NeuroBookMood from "nbook/ui/brand/NeuroBookMood.vue";

defineOptions({name: "ShelfEmptyState"});

const props = defineProps<{
    locale: DisplayLocale;
    /** 作品目录（新作品建在这里）；null 表示还没设，新建时会先问。 */
    library: string | null;
}>();

const emit = defineEmits<{
    (event: "create"): void;
    (event: "add-existing"): void;
}>();

const TEXT = {
    title: {"zh-CN": "书架还是空的", "en-US": "The shelf is empty"},
    what: {"zh-CN": "一部作品就是一个文件夹，章节与设定都是里面的 Markdown 文件，随时可以备份、同步或用别的编辑器打开。", "en-US": "A book is a folder; chapters and notes are Markdown files inside it, so you can back it up, sync it, or open it in any editor."},
    where: {"zh-CN": "新建的作品会放在 {library}。", "en-US": "New books are created in {library}."},
    whereUnset: {"zh-CN": "第一次新建时会问一次作品放在哪，之后记住。", "en-US": "The first time you create a book you will be asked where to keep it; the choice is remembered."},
    create: {"zh-CN": "新建作品", "en-US": "New Book"},
    addExisting: {"zh-CN": "加入已有目录", "en-US": "Add an Existing Folder"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);
const where = computed(() => (props.library === null ? text(TEXT.whereUnset) : text(formatText(TEXT.where, {library: props.library}))));
</script>

<template>
    <section class="shelf-empty" :aria-label="text(TEXT.title)" data-shelf-empty>
        <NeuroBookMood state="focus" class="shelf-empty__mascot" />
        <div class="shelf-empty__body">
            <h2 class="shelf-empty__title">{{ text(TEXT.title) }}</h2>
            <p class="shelf-empty__text">{{ text(TEXT.what) }}</p>
            <p class="shelf-empty__text shelf-empty__where">{{ where }}</p>
            <div class="shelf-empty__actions">
                <Button variant="primary" data-shelf-empty-create @click="emit('create')">{{ text(TEXT.create) }}</Button>
                <Button variant="secondary" data-shelf-empty-add @click="emit('add-existing')">{{ text(TEXT.addExisting) }}</Button>
            </div>
        </div>
    </section>
</template>

<style scoped>
.shelf-empty {
    container-type: inline-size;
    display: flex;
    align-items: flex-start;
    gap: var(--space-6);
    padding: var(--space-6) var(--space-7);
    border-radius: var(--radius-panel);
    background: var(--page-surface, var(--bg-panel));
    box-shadow: var(--page-lift, var(--elevation-flat));
}

.shelf-empty__mascot {
    flex: 0 0 auto;
    width: 112px;
    border-radius: var(--radius-panel);
}

.shelf-empty__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.shelf-empty__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
}

.shelf-empty__text {
    margin: 0;
    max-width: 36em;
    color: var(--text-secondary);
    font-family: var(--font-display);
    font-size: 16px;
    line-height: var(--leading-reading);
}

.shelf-empty__where {
    color: var(--text-muted);
    font-size: var(--text-sm);
    font-family: var(--font-ui);
}

.shelf-empty__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

@container (max-width: 480px) {
    .shelf-empty {
        flex-direction: column;
        align-items: center;
        text-align: center;
    }

    .shelf-empty__actions {
        justify-content: center;
    }
}
</style>
