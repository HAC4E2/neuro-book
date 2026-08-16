<script setup lang="ts">
import {nextTick, onMounted, ref, watch} from "vue";

export type LabEventEntry = {
    id: number;
    time: string;
    name: string;
    payload: unknown;
};

type LabReadout = {label: string; value: string};
type LabCheck = {label: string; pass: boolean; detail: string};

const props = defineProps<{
    targetSelector: string;
    sceneId: string;
    revision: number;
    events: LabEventEntry[];
    mode: "inspection" | "events";
}>();

const emit = defineEmits<{
    (event: "clear-events"): void;
}>();

const readout = ref<LabReadout[]>([]);
const checks = ref<LabCheck[]>([]);

function targetElement(): HTMLElement | null {
    if (typeof document === "undefined") return null;
    return document.querySelector<HTMLElement>(props.targetSelector);
}

function accessibleName(element: HTMLElement): string {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
        const text = labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (text) return text;
    }
    const id = element.id;
    if (id) {
        const label = Array.from(document.querySelectorAll("label")).find((candidate) => candidate.htmlFor === id);
        if (label?.textContent?.trim()) return label.textContent.trim();
    }
    return element.closest("label")?.textContent?.trim() || element.textContent?.trim() || "";
}

function inspect(): void {
    const element = targetElement();
    if (element === null) {
        readout.value = [{label: "目标", value: "未找到"}];
        checks.value = [{label: "目标存在", pass: false, detail: props.targetSelector}];
        return;
    }
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const attrs = ["role", "id", "aria-describedby", "aria-invalid", "aria-expanded", "aria-checked", "disabled", "readonly"]
        .map((name) => `${name}=${element.getAttribute(name) ?? "—"}`)
        .join(" · ");
    readout.value = [
        {label: "尺寸", value: `${Math.round(rect.width)} × ${Math.round(rect.height)} px`},
        {label: "内边距", value: styles.padding},
        {label: "背景 / 文字", value: `${styles.backgroundColor} / ${styles.color}`},
        {label: "描边 / 圆角", value: `${styles.border} / ${styles.borderRadius}`},
        {label: "阴影 / 背景滤镜", value: `${styles.boxShadow || "none"} / ${styles.backdropFilter || "none"}`},
        {label: "排版", value: `${styles.fontFamily} · ${styles.fontSize} · ${styles.lineHeight}`},
        {label: "ARIA / 属性", value: attrs},
    ];

    const idCount = element.id === "" ? 0 : Array.from(document.querySelectorAll("[id]")).filter((candidate) => candidate.id === element.id).length;
    const describedBy = (element.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    const describedByExists = describedBy.every((id) => document.getElementById(id) !== null);
    const invalidRequired = props.sceneId === "invalid";
    const invalidActual = element.getAttribute("aria-invalid") === "true";
    const expanded = element.getAttribute("aria-expanded");
    const listboxExists = document.querySelector("[role='listbox']") !== null;
    const canvas = element.closest<HTMLElement>(".lab-canvas");
    const fitsCanvas = canvas === null || element.scrollWidth === 0 || element.scrollWidth <= Math.max(element.clientWidth, canvas.clientWidth) + 1;
    checks.value = [
        {label: "目标存在", pass: true, detail: props.targetSelector},
        {label: "可访问名称", pass: accessibleName(element).length > 0, detail: accessibleName(element) || "缺少名称"},
        {label: "id 唯一", pass: element.id === "" || idCount === 1, detail: element.id ? `${element.id} × ${idCount}` : "未设置 id"},
        {label: "aria-describedby", pass: describedByExists, detail: describedBy.length === 0 ? "未设置" : describedBy.join(", ")},
        {label: "invalid 语义", pass: !invalidRequired || invalidActual, detail: invalidRequired ? `期望 true，实际 ${element.getAttribute("aria-invalid") ?? "—"}` : "当前场景不要求"},
        {label: "combobox 展开关系", pass: expanded !== "true" || listboxExists, detail: expanded === "true" ? `listbox ${listboxExists ? "存在" : "缺失"}` : "未展开"},
        {label: "预览宽度", pass: fitsCanvas, detail: fitsCanvas ? "未超出预览边界" : "目标内容超出预览边界"},
    ];
}

function formatPayload(payload: unknown): string {
    try {
        return JSON.stringify(payload);
    } catch {
        return "不可序列化";
    }
}

watch(() => [props.targetSelector, props.sceneId, props.revision, props.mode], () => {
    if (props.mode === "inspection") void nextTick(inspect);
}, {immediate: true});

onMounted(inspect);
</script>

<template>
    <div v-if="props.mode === 'inspection'" class="lab-inspection">
        <section>
            <h3>结构检查</h3>
            <div v-for="check in checks" :key="check.label" class="lab-check" :class="check.pass ? 'is-pass' : 'is-fail'">
                <span :class="check.pass ? 'i-lucide-check-circle-2' : 'i-lucide-circle-alert'" aria-hidden="true"></span>
                <span><strong>{{ check.label }}</strong> · {{ check.detail }}</span>
            </div>
        </section>

        <section>
            <h3>真实计算样式</h3>
            <dl class="lab-readout">
                <template v-for="item in readout" :key="item.label">
                    <dt>{{ item.label }}</dt>
                    <dd>{{ item.value }}</dd>
                </template>
            </dl>
        </section>

        <section>
            <h3>说明</h3>
            <p class="lab-status">读数来自真实目标元素的 getComputedStyle 与 DOM 属性；切换主题或变量后重新采样。</p>
        </section>
    </div>

    <section v-if="props.mode === 'events'" class="lab-events" aria-label="组件事件日志">
        <div class="lab-inspector__header">
            <strong>事件日志</strong>
            <button type="button" class="lab-icon-action" title="清空事件日志" aria-label="清空事件日志" @click="emit('clear-events')">
                <span class="i-lucide-trash-2" aria-hidden="true"></span>
            </button>
        </div>
        <div v-if="props.events.length === 0" class="lab-status">等待组件事件</div>
        <div v-for="event in props.events" :key="event.id" class="lab-event">
            <time>{{ event.time }}</time>
            <code>{{ event.name }}</code>
            <span>{{ formatPayload(event.payload) }}</span>
        </div>
    </section>
</template>
