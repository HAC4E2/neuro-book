<script setup lang="ts">
/** 品牌的标志 + 字标横排（同名 .md）：成品 SVG 当遮罩、以 currentColor 填色，所以跟随文字颜色，明暗主题都能用。 */
defineOptions({name: "NeuroBookLockup"});
</script>

<template>
    <span class="nb-brand-lockup" role="img" aria-label="NeuroBook" />
</template>

<style scoped>
.nb-brand-lockup {
    /* 成品的宽高比 947.47 : 165.88；高度由使用方给，宽度随之。 */
    display: inline-block;
    aspect-ratio: 947.47 / 165.88;
    height: 1em;
    background: currentColor;
    -webkit-mask: url("./neurobook-lockup.svg") no-repeat center / contain;
    mask: url("./neurobook-lockup.svg") no-repeat center / contain;
}
</style>
