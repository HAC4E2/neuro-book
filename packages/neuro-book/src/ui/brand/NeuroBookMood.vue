<script lang="ts">
/**
 * 看板娘的心情组件（同名 .md）：包一层品牌成品里的原生自定义元素 `<neurobook-mood>`，让 Vue 代码按 props 用它。
 * 用渲染函数而不是模板：自定义元素不在 Vue 的组件表里，模板类型检查认不出它。
 * 成品脚本靠 Web Animations API（`animate`、`getAnimations`）驱动；环境没有它时画一个不动的标志，不让页面因此出错。
 */
import {defineComponent, h} from "vue";

import "./neurobook-mood.js";
import type {NeuroBookMoodState} from "./neurobook-mood";

const ANIMATABLE = typeof Element !== "undefined" && typeof Element.prototype.animate === "function" && typeof Element.prototype.getAnimations === "function";

export default defineComponent({
    name: "NeuroBookMood",
    props: {
        state: {type: String as () => NeuroBookMoodState, required: true},
        /** `dark`：透明底，放在深色背景上；默认赤红底块。 */
        variant: {type: String as () => "tile" | "dark", default: "tile"},
        /** 停掉循环动画。 */
        paused: {type: Boolean, default: false},
    },
    setup(props) {
        return () => (ANIMATABLE
            // 自定义元素按属性收值：paused 是布尔属性，有就算真。
            ? h("neurobook-mood", {state: props.state, variant: props.variant, ...(props.paused ? {paused: ""} : {}), class: "nb-brand-mood"})
            : h("span", {class: ["nb-brand-mood", "nb-brand-mood--still", `nb-brand-mood--${props.variant}`], role: "img", "aria-label": "NeuroBook", "data-mood": props.state}));
    },
});
</script>

<style>
/* 不动的回退：标志当遮罩着色，底块与成品的赤红底一致。 */
.nb-brand-mood--still {
    display: inline-block;
    aspect-ratio: 1;
    border-radius: 18%;
    background: #871222;
    -webkit-mask: url("./neurobook-mark.svg") no-repeat center / 70%;
    mask: url("./neurobook-mark.svg") no-repeat center / 70%;
}

.nb-brand-mood--still.nb-brand-mood--dark {
    background: #f7f2ec;
}
</style>
