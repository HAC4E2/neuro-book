<script setup lang="ts">
/** 封面（同名 .md）：有图用图，没图按书名与作品色排一张。 */
import {computed, ref, watch} from "vue";

import {bookColorStyle, lightColor} from "../shelf-format";

defineOptions({name: "BookCover"});

const props = withDefaults(defineProps<{
    id: string;
    title: string;
    color: string | null;
    /** 封面图地址；没有或加载失败时用排版封面。 */
    src?: string | null;
    /** 宽度（px）；高按 2:3。 */
    width?: number;
    /** 封面下方的小字（题材、“长篇”这类）；只在排版封面上。 */
    caption?: string;
}>(), {src: null, width: 84, caption: ""});

const failed = ref(false);
watch(() => props.src, () => {
    failed.value = false;
});
const showImage = computed(() => props.src !== null && props.src !== "" && !failed.value);
const style = computed(() => ({...bookColorStyle({id: props.id, color: props.color}), "--cover-w": `${String(props.width)}px`}));
// 字号随封面宽度与书名长度：短名大一档，长名小一档，四行放不下就截断。
const titleSize = computed(() => {
    const length = Array.from(props.title).length;
    const scale = length <= 4 ? 0.19 : length <= 10 ? 0.15 : 0.12;
    return `${String(Math.round(props.width * scale))}px`;
});
</script>

<template>
    <span class="book-cover book-color" :class="{'book-color--custom': color !== null, 'book-cover--light': lightColor(color)}" :style="style" role="img" :aria-label="title" data-book-cover>
        <img v-if="showImage" :src="src ?? ''" alt="" class="book-cover__image" @error="failed = true">
        <span v-else class="book-cover__typo" data-book-cover-typo>
            <span class="book-cover__ornament" aria-hidden="true"></span>
            <span class="book-cover__title" :style="{fontSize: titleSize}">{{ title }}</span>
            <span class="book-cover__caption">{{ caption }}</span>
        </span>
    </span>
</template>

<style src="./book-colors.css"></style>

<style scoped>
.book-cover {
    position: relative;
    display: block;
    flex: 0 0 auto;
    overflow: hidden;
    width: var(--cover-w);
    aspect-ratio: 2 / 3;
    border-radius: 3px 6px 6px 3px;
    background: var(--book-bg);
    /* 书口那一侧略亮、书脊那一侧略暗：是光不是颜色。投影是封面从纸面抬起的厚度。 */
    background-image: linear-gradient(to right, rgb(0 0 0 / 0.22), rgb(255 255 255 / 0.10) 6%, transparent 14%);
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.18), 0 6px 14px rgb(0 0 0 / 0.16);
    color: #f7f2ec;
}

.book-cover--light {
    color: #2e211b;
}

.book-cover__image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.book-cover__typo {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 12% 10%;
    text-align: center;
}

.book-cover__ornament {
    width: 36%;
    height: 1px;
    background: #e1b285;
    opacity: 0.9;
}

.book-cover__title {
    display: -webkit-box;
    overflow: hidden;
    font-family: var(--font-display);
    font-weight: var(--weight-strong);
    line-height: 1.25;
    letter-spacing: 0.04em;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
}

.book-cover__caption {
    min-height: 1em;
    font-size: calc(var(--cover-w) * 0.1);
    letter-spacing: 0.1em;
    opacity: 0.75;
}
</style>
