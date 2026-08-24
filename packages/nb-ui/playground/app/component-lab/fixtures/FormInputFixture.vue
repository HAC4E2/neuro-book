<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, getLabScene, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 5 种不同设计方案切换
const designStyle = ref<"macos" | "minimal" | "outlined" | "crystal" | "solid">("macos");
const designOptions = [
    {label: "方案 1: macOS 沉浸输入槽 (推荐)", value: "macos"},
    {label: "方案 2: 现代极简无框卡片", value: "minimal"},
    {label: "方案 3: 精工微轮廓与浮雕外框", value: "outlined"},
    {label: "方案 4: 悬浮微晶玻璃胶囊", value: "crystal"},
    {label: "方案 5: 实底高对比瓷片", value: "solid"},
];

// 真实小说创作与工作区领域数据
const bookTitle = ref("《星穹折叠：第零纪元》");
const worldView = ref("赛博纪元·轨道空港浮空城");
const searchKeyword = ref("量子纠缠逆熵通讯");
const accessPasscode = ref("Alpha-7890-Omega");
const showPassword = ref(false);

const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));
const disabled = computed(() => Boolean(controls.value.disabled) || scene.value.disabled === true);
const readonly = computed(() => Boolean(controls.value.readonly));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    bookTitle.value = scene.value.invalid ? "" : "《星穹折叠：第零纪元》";
    worldView.value = "赛博纪元·轨道空港浮空城";
    searchKeyword.value = "量子纠缠逆熵通讯";
    accessPasscode.value = "Alpha-7890-Omega";
}

function report(name: string, payload?: unknown): void {
    if (!props.definition.events.includes(name)) return;
    emit("lab-event", name, payload);
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 顶层设计风格切换栏 -->
        <div class="mb-6 flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 bg-[color-mix(in_srgb,var(--bg-panel)_75%,transparent)] backdrop-blur-xl border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)] shadow-sm">
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">FormInput 方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">输入文本体验光晕与实时聚焦手感</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 1：macOS 经典沉浸输入槽（推荐）</strong>——`rounded-[6px]` 超椭圆；深灰 6% 实底微凹槽 + 14% 微边框，聚焦时平滑扩散 <strong>2.5px 品牌蓝柔光晕</strong>（`var(--focus-ring)`），沉静典雅。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 2：现代极简无框卡片</strong>——`rounded-[8px]` 大圆角；常态无边框，采用 8% 纯平浅色底，聚焦时底色跃升至 16% 并平滑浮现 <strong>底沿 2px 品牌高亮下划线</strong>。
                    </span>
                    <span v-else-if="designStyle === 'outlined'" class="scheme-banner-text">
                        <strong>方案 3：精工微轮廓与浮雕外框</strong>——`rounded-[5px]` 锐利精工角；1px 精确线框 + 0.5px 内阴影，聚焦时边框变亮并伴随 <strong>1px 锐利高对比双层轮廓</strong>，工业精密感。
                    </span>
                    <span v-else-if="designStyle === 'crystal'" class="scheme-banner-text">
                        <strong>方案 4：悬浮微晶玻璃胶囊</strong>——`rounded-[10px]` 饱满胶囊；75% 半透明高斯磨砂底 + 柔光反光边缘，聚焦时扩散 <strong>4px 全景晶体弥散光圈</strong>。
                    </span>
                    <span v-else-if="designStyle === 'solid'" class="scheme-banner-text">
                        <strong>方案 5：实底高对比瓷片</strong>——`rounded-[6px]` 几何方圆；常态 12% 坚实底色 + 纯黑/纯白高对比文字，聚焦时直接切换为 <strong>品牌实色细边 + 柔光投影</strong>。
                    </span>
                </div>
            </div>
        </div>

        <!-- macOS 紧凑卡片容器 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] pb-3">
                <div class="flex items-center gap-2">
                    <span class="i-lucide-book-open h-4 w-4 text-[var(--accent-main)]" aria-hidden="true" />
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">作品档案核心元数据录入</h3>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--accent-main)]">
                    表单输入 · FormInput
                </span>
            </div>

            <!-- 5 种方案渲染演示区 -->
            <div class="space-y-4">
                <!-- 1. 作品主标题 -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)] flex items-center justify-between">
                        <span>主标题（必填）</span>
                        <span v-if="scene.invalid" class="text-[11px] text-[var(--status-danger)]">标题不能为空</span>
                    </label>
                    <div
                        class="relative flex items-center transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                        :class="[
                            designStyle === 'macos' ? 'h-9 px-3 rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]' : '',
                            designStyle === 'minimal' ? 'h-9 px-3 rounded-[8px] border-b-2 border-transparent bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] focus-within:border-b-[var(--accent-main)]' : '',
                            designStyle === 'outlined' ? 'h-9 px-3 rounded-[5px] border border-[color-mix(in_srgb,var(--text-main)_25%,transparent)] bg-transparent shadow-inner focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_0_1px_var(--accent-main)]' : '',
                            designStyle === 'crystal' ? 'h-9 px-3 rounded-[10px] border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]' : '',
                            designStyle === 'solid' ? 'h-9 px-3 rounded-[6px] border border-transparent bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] focus-within:border-[var(--accent-main)] focus-within:bg-[var(--bg-panel)] focus-within:shadow-sm' : '',
                            scene.invalid ? 'border-[var(--status-danger)] focus-within:border-[var(--status-danger)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--status-danger)_25%,transparent)]' : '',
                            disabled ? 'opacity-45 cursor-not-allowed' : '',
                        ]"
                    >
                        <input
                            v-model="bookTitle"
                            id="nb-lab-target"
                            type="text"
                            :disabled="disabled"
                            :readonly="readonly"
                            placeholder="请输入作品主标题..."
                            class="w-full bg-transparent text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed"
                            @focus="report('focus', {field: 'bookTitle'})"
                            @input="report('update:modelValue', {field: 'bookTitle', value: bookTitle})"
                        />
                    </div>
                </div>

                <!-- 2. 世界观代号（前缀插槽） -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">世界观锚点代号（带前缀）</label>
                    <div
                        class="relative flex items-center gap-2 transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                        :class="[
                            designStyle === 'macos' ? 'h-9 px-3 rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]' : '',
                            designStyle === 'minimal' ? 'h-9 px-3 rounded-[8px] border-b-2 border-transparent bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] focus-within:border-b-[var(--accent-main)]' : '',
                            designStyle === 'outlined' ? 'h-9 px-3 rounded-[5px] border border-[color-mix(in_srgb,var(--text-main)_25%,transparent)] bg-transparent shadow-inner focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_0_1px_var(--accent-main)]' : '',
                            designStyle === 'crystal' ? 'h-9 px-3 rounded-[10px] border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]' : '',
                            designStyle === 'solid' ? 'h-9 px-3 rounded-[6px] border border-transparent bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] focus-within:border-[var(--accent-main)] focus-within:bg-[var(--bg-panel)] focus-within:shadow-sm' : '',
                            disabled ? 'opacity-45 cursor-not-allowed' : '',
                        ]"
                    >
                        <span class="text-xs font-mono font-bold text-[var(--accent-main)] select-none">@WORLD/</span>
                        <input
                            v-model="worldView"
                            type="text"
                            :disabled="disabled"
                            :readonly="readonly"
                            placeholder="设定集锚点..."
                            class="w-full bg-transparent text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed"
                            @focus="report('focus', {field: 'worldView'})"
                        />
                    </div>
                </div>

                <!-- 3. AI 灵感搜索栏（带清除按钮） -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">设定库全文检索（搜索类型）</label>
                    <div
                        class="relative flex items-center gap-2 transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                        :class="[
                            designStyle === 'macos' ? 'h-9 px-3 rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]' : '',
                            designStyle === 'minimal' ? 'h-9 px-3 rounded-[8px] border-b-2 border-transparent bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] focus-within:border-b-[var(--accent-main)]' : '',
                            designStyle === 'outlined' ? 'h-9 px-3 rounded-[5px] border border-[color-mix(in_srgb,var(--text-main)_25%,transparent)] bg-transparent shadow-inner focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_0_1px_var(--accent-main)]' : '',
                            designStyle === 'crystal' ? 'h-9 px-3 rounded-[10px] border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]' : '',
                            designStyle === 'solid' ? 'h-9 px-3 rounded-[6px] border border-transparent bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] focus-within:border-[var(--accent-main)] focus-within:bg-[var(--bg-panel)] focus-within:shadow-sm' : '',
                            disabled ? 'opacity-45 cursor-not-allowed' : '',
                        ]"
                    >
                        <span class="i-lucide-search h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        <input
                            v-model="searchKeyword"
                            type="search"
                            :disabled="disabled"
                            :readonly="readonly"
                            placeholder="检索大纲、人物或灵感词条..."
                            class="w-full bg-transparent text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed"
                            @focus="report('focus', {field: 'searchKeyword'})"
                        />
                        <button
                            v-if="searchKeyword"
                            type="button"
                            class="i-lucide-x h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                            @click="searchKeyword = ''"
                        />
                    </div>
                </div>

                <!-- 4. 加密访问密钥（密码类型 + 显隐切换） -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-medium text-[var(--text-secondary)]">保密大纲访问凭证（密码输入）</label>
                    <div
                        class="relative flex items-center gap-2 transition-[background-color,border-color,box-shadow,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]"
                        :class="[
                            designStyle === 'macos' ? 'h-9 px-3 rounded-[6px] border border-[color-mix(in_srgb,var(--text-main)_16%,transparent)] bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] focus-within:border-[var(--accent-main)] focus-within:shadow-[var(--focus-ring)]' : '',
                            designStyle === 'minimal' ? 'h-9 px-3 rounded-[8px] border-b-2 border-transparent bg-[color-mix(in_srgb,var(--text-main)_8%,transparent)] focus-within:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] focus-within:border-b-[var(--accent-main)]' : '',
                            designStyle === 'outlined' ? 'h-9 px-3 rounded-[5px] border border-[color-mix(in_srgb,var(--text-main)_25%,transparent)] bg-transparent shadow-inner focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_0_1px_var(--accent-main)]' : '',
                            designStyle === 'crystal' ? 'h-9 px-3 rounded-[10px] border border-[color-mix(in_srgb,var(--text-main)_15%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_60%,transparent)] backdrop-blur-md focus-within:border-[var(--accent-main)] focus-within:shadow-[0_0_12px_color-mix(in_srgb,var(--accent-main)_35%,transparent)]' : '',
                            designStyle === 'solid' ? 'h-9 px-3 rounded-[6px] border border-transparent bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] focus-within:border-[var(--accent-main)] focus-within:bg-[var(--bg-panel)] focus-within:shadow-sm' : '',
                            disabled ? 'opacity-45 cursor-not-allowed' : '',
                        ]"
                    >
                        <span class="i-lucide-lock h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
                        <input
                            v-model="accessPasscode"
                            :type="showPassword ? 'text' : 'password'"
                            :disabled="disabled"
                            :readonly="readonly"
                            placeholder="输入解密密钥..."
                            class="w-full font-mono bg-transparent text-sm text-[var(--text-main)] placeholder:text-[var(--text-muted)] outline-none disabled:cursor-not-allowed"
                            @focus="report('focus', {field: 'accessPasscode'})"
                        />
                        <button
                            type="button"
                            class="h-4 w-4 shrink-0 text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer"
                            :class="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                            @click="showPassword = !showPassword"
                        />
                    </div>
                </div>
            </div>

            <!-- 底部状态指示 -->
            <div class="mt-5 flex items-center justify-between border-t border-[color-mix(in_srgb,var(--border-color)_40%,transparent)] pt-3 text-[11px] text-[var(--text-muted)]">
                <span class="font-mono">ID: {{ scene.id }} | {{ scene.label }}</span>
                <span>当前方案: {{ designOptions.find(o => o.value === designStyle)?.label }}</span>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.macos-compact-card {
    width: 100%;
    max-width: 520px;
    margin: var(--space-3) auto 0;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 75%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 26%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}

.scheme-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}

.scheme-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    background: var(--accent-main);
    color: var(--text-inverse);
    letter-spacing: 0.02em;
    flex-shrink: 0;
}

.scheme-banner-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.5;
}
</style>
