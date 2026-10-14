<script setup lang="ts">
/** 品牌的图形标志（同名 .md）：成品 SVG 当遮罩、以 currentColor 填色，所以跟随文字颜色，明暗主题都能用。 */
defineOptions({name: "NeuroBookMark"});
</script>

<template>
    <span class="nb-brand-mark" role="img" aria-label="NeuroBook" />
</template>

<style scoped>
.nb-brand-mark {
    /* 成品是正方形（viewBox 90.7 × 90.7）；大小由使用方给。 */
    display: inline-block;
    aspect-ratio: 1;
    height: 1em;
    background: currentColor;
    -webkit-mask: url("./neurobook-mark.svg") no-repeat center / contain;
    mask: url("./neurobook-mark.svg") no-repeat center / contain;
}
</style>
