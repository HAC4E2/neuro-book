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

// 6 种不同设计方案切换
const designStyle = ref<"screenshot" | "macos" | "minimal" | "card" | "soft" | "neon">("screenshot");
const designOptions = [
    {label: "方案 1: 截图标准实心风 (对齐截图 · 推荐)", value: "screenshot"},
    {label: "方案 2: macOS 原生微拟物 (微光反光)", value: "macos"},
    {label: "方案 3: 现代极简线条", value: "minimal"},
    {label: "方案 4: 磨砂交互卡片", value: "card"},
    {label: "方案 5: 圆润柔光胶囊", value: "soft"},
    {label: "方案 6: 科技霓虹发光", value: "neon"},
];

// 树状复选框状态（对齐截图层级结构）
const parentChecked = ref<boolean | "indeterminate">("indeterminate");
const subItem1 = ref(false);
const subItem2 = ref(true);
const subItem3 = ref(true);
const item4 = ref(false);
const item5 = ref(true);
const item6 = ref(false);

// 单选展示
const selectedRadio = ref("option3");

// 联动计算父级半选/全选/未选状态
function updateParentState(): void {
    const subs = [subItem1.value, subItem2.value, subItem3.value];
    const trueCount = subs.filter(Boolean).length;
    if (trueCount === 3) {
        parentChecked.value = true;
    } else if (trueCount === 0) {
        parentChecked.value = false;
    } else {
        parentChecked.value = "indeterminate";
    }
}

function toggleParent(): void {
    if (parentChecked.value === true) {
        parentChecked.value = false;
        subItem1.value = false;
        subItem2.value = false;
        subItem3.value = false;
    } else {
        parentChecked.value = true;
        subItem1.value = true;
        subItem2.value = true;
        subItem3.value = true;
    }
}

function toggleSub(index: 1 | 2 | 3): void {
    if (index === 1) subItem1.value = !subItem1.value;
    else if (index === 2) subItem2.value = !subItem2.value;
    else if (index === 3) subItem3.value = !subItem3.value;
    updateParentState();
}

const controls = ref<Record<string, string | boolean>>({});
const scene = computed(() => getLabScene(props.definition, props.sceneId));

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
    parentChecked.value = "indeterminate";
    subItem1.value = false;
    subItem2.value = true;
    subItem3.value = true;
    item4.value = false;
    item5.value = true;
    item6.value = false;
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
                    <span class="text-xs font-semibold text-[var(--text-secondary)]">设计方案:</span>
                    <SegmentedControl
                        v-model="designStyle"
                        :options="designOptions"
                        size="sm"
                    />
                </div>
                <span class="text-xs text-[var(--text-muted)]">点击整行或图标即可流畅触发状态切换</span>
            </div>

            <!-- 设计说明条 -->
            <div class="scheme-banner">
                <div class="flex items-center gap-2">
                    <span class="scheme-pill">设计解析</span>
                    <span v-if="designStyle === 'screenshot'" class="scheme-banner-text">
                        <strong>方案 1：截图标准实心风（100% 对齐截图）</strong>——无多余杂乱外边框。未选中态为柔和纯净的半透深灰实心底座；选中态为纯正 Apple 蓝底配合加粗白色对勾；支持 <code>[-]</code> 减号半选状态（Indeterminate）与树状子级缩进。
                    </span>
                    <span v-else-if="designStyle === 'macos'" class="scheme-banner-text">
                        <strong>方案 2：macOS 原生微拟物</strong>——带 0.5px 顶部反光微边框、柔和内阴影、渐变蓝底与微弹簧回弹动效。
                    </span>
                    <span v-else-if="designStyle === 'minimal'" class="scheme-banner-text">
                        <strong>方案 3：现代极简线条</strong>——1.5px 纯净细线框，Hover 触发 3px 呼吸光圈。
                    </span>
                    <span v-else-if="designStyle === 'card'" class="scheme-banner-text">
                        <strong>方案 4：磨砂交互卡片</strong>——整行卡片化包裹，选中时卡片与勾选框同步高亮。
                    </span>
                    <span v-else-if="designStyle === 'soft'" class="scheme-banner-text">
                        <strong>方案 5：圆润柔光胶囊</strong>——超椭圆大圆角形态，温润微雕质感。
                    </span>
                    <span v-else-if="designStyle === 'neon'" class="scheme-banner-text">
                        <strong>方案 6：科技霓虹发光</strong>——高饱和霓虹色与多层径向外发光晕影。
                    </span>
                </div>
            </div>
        </div>

        <!-- 紧凑 macOS 容器卡片 -->
        <div class="macos-compact-card">
            <!-- 容器标题栏 -->
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <h3 class="text-sm font-semibold text-[var(--text-main)]">功能开关与多选设置</h3>
                    <p class="text-xs text-[var(--text-muted)]">支持选中、未选中、半选（Indeterminate）与单选按钮。</p>
                </div>
                <span class="rounded-full bg-[color-mix(in_srgb,var(--accent-main)_12%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent-main)]">
                    复选框 · FormCheckbox
                </span>
            </div>

            <!-- 复选框交互列表展示 -->
            <div class="stage-box flex flex-col gap-2.5">
                <!-- ================= 方案 1：截图标准实心风（对齐用户上传的图一与图二） ================= -->
                <template v-if="designStyle === 'screenshot'">
                    <div class="flex flex-col gap-2">
                        <!-- 父级项（支持半选 [-] / 全选 [✓] / 清空 [ ]） -->
                        <div
                            class="group flex items-center gap-3 py-1 px-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            @click="toggleParent"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="parentChecked !== false ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="parentChecked === 'indeterminate'" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M4 8H12" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
                                </svg>
                                <svg v-else-if="parentChecked === true" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[14px] font-medium text-[var(--text-main)]">核心文档同步</span>
                        </div>

                        <!-- 缩进子项 1（明确 32px 缩进，对齐父级文字） -->
                        <div
                            class="group flex items-center gap-3 py-1 pr-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            style="padding-left: 32px;"
                            @click="toggleSub(1)"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="subItem1 ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="subItem1" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[13.5px] text-[var(--text-main)]">同步 Markdown 纯文本源文件</span>
                        </div>

                        <!-- 缩进子项 2 -->
                        <div
                            class="group flex items-center gap-3 py-1 pr-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            style="padding-left: 32px;"
                            @click="toggleSub(2)"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="subItem2 ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="subItem2" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[13.5px] text-[var(--text-main)]">同步 Word 与 EPUB 导出载荷</span>
                        </div>

                        <!-- 缩进子项 3 -->
                        <div
                            class="group flex items-center gap-3 py-1 pr-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            style="padding-left: 32px;"
                            @click="toggleSub(3)"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="subItem3 ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="subItem3" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[13.5px] text-[var(--text-main)]">自动拉取远端冲突解决标记</span>
                        </div>

                        <!-- 独立项 4 -->
                        <div
                            class="group flex items-center gap-3 py-1 px-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            @click="item4 = !item4"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="item4 ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="item4" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[14px] text-[var(--text-main)]">启用实时自动保存快照</span>
                        </div>

                        <!-- 独立项 5 -->
                        <div
                            class="group flex items-center gap-3 py-1 px-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            @click="item5 = !item5"
                        >
                            <div
                                class="box-screenshot shrink-0 transition-transform active:scale-95"
                                :class="item5 ? 'box-screenshot-checked' : ''"
                            >
                                <svg v-if="item5" viewBox="0 0 16 16" fill="none" class="w-3.5 h-3.5 text-white pointer-events-none">
                                    <path d="M3.5 8.2L6.3 11.2L12.5 4.8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="text-[14px] text-[var(--text-main)]">启用智能双向滚动虚化</span>
                        </div>
                    </div>

                    <!-- 附带单选按钮组（对齐图一 Radio Button 风格） -->
                    <div class="mt-4 pt-3 border-t border-[color-mix(in_srgb,var(--border-color)_50%,transparent)] flex flex-col gap-2">
                        <span class="text-xs font-semibold text-[var(--text-secondary)]">附带单选按钮（对齐图一风格）:</span>
                        <div
                            v-for="(rLabel, rKey) in {option1: '单选按钮选项一', option2: '单选按钮选项二', option3: '单选按钮选项三'}"
                            :key="rKey"
                            class="group flex items-center gap-3 py-1 px-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                            @click="selectedRadio = rKey"
                        >
                            <div
                                class="radio-screenshot shrink-0 transition-transform active:scale-95"
                                :class="selectedRadio === rKey ? 'radio-screenshot-checked' : ''"
                            >
                                <span v-if="selectedRadio === rKey" class="h-2 w-2 rounded-full bg-white pointer-events-none"></span>
                            </div>
                            <span class="text-[13.5px] text-[var(--text-main)]">{{ rLabel }}</span>
                        </div>
                    </div>
                </template>

                <!-- ================= 方案 2：macOS 原生微拟物 ================= -->
                <template v-else-if="designStyle === 'macos'">
                    <div
                        v-for="(item, idx) in [{name: '启用云端实时同步', desc: '编辑内容变更时自动同步至远端仓库', val: subItem2, set: () => subItem2 = !subItem2}, {name: '生成 Markdown 格式快照', desc: '每次保存自动备份为纯文本快照', val: item5, set: () => item5 = !item5}]"
                        :key="idx"
                        class="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                        @click="item.set()"
                    >
                        <div class="box-macos shrink-0" :class="item.val ? 'box-macos-checked' : ''">
                            <span class="i-lucide-check icon-check" aria-hidden="true"></span>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-[13.5px] font-medium text-[var(--text-main)]">{{ item.name }}</span>
                            <span class="text-xs text-[var(--text-muted)]">{{ item.desc }}</span>
                        </div>
                    </div>
                </template>

                <!-- ================= 方案 3：现代极简线条 ================= -->
                <template v-else-if="designStyle === 'minimal'">
                    <div
                        v-for="(item, idx) in [{name: '启用云端实时同步', desc: '极简纤细描边与利落反馈', val: subItem2, set: () => subItem2 = !subItem2}, {name: '生成 Markdown 格式快照', desc: '保存时生成副本', val: item4, set: () => item4 = !item4}]"
                        :key="idx"
                        class="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                        @click="item.set()"
                    >
                        <div class="box-minimal shrink-0" :class="item.val ? 'box-minimal-checked' : ''">
                            <span class="i-lucide-check icon-check" aria-hidden="true"></span>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-[13.5px] font-medium text-[var(--text-main)]">{{ item.name }}</span>
                            <span class="text-xs text-[var(--text-muted)]">{{ item.desc }}</span>
                        </div>
                    </div>
                </template>

                <!-- ================= 方案 4：磨砂交互卡片 ================= -->
                <template v-else-if="designStyle === 'card'">
                    <div
                        v-for="(item, idx) in [{name: '启用云端实时同步', desc: '整行卡片化响应与交互', val: subItem2, set: () => subItem2 = !subItem2}, {name: '生成 Markdown 格式快照', desc: '保存时自动生成纯文本副本', val: item4, set: () => item4 = !item4}]"
                        :key="idx"
                        class="card-row flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none"
                        :class="item.val ? 'card-row-checked' : 'card-row-unchecked'"
                        @click="item.set()"
                    >
                        <div class="flex items-center gap-3">
                            <div class="box-screenshot shrink-0" :class="item.val ? 'box-screenshot-checked' : ''">
                                <span v-if="item.val" class="i-lucide-check text-white text-[13px] stroke-[2.5] pointer-events-none"></span>
                            </div>
                            <div class="flex flex-col">
                                <span class="text-[13.5px] font-semibold text-[var(--text-main)]">{{ item.name }}</span>
                                <span class="text-xs text-[var(--text-muted)]">{{ item.desc }}</span>
                            </div>
                        </div>
                        <span class="text-xs font-mono font-semibold" :class="item.val ? 'text-[var(--accent-main)]' : 'text-[var(--text-muted)]'">
                            {{ item.val ? '已启用' : '已关闭' }}
                        </span>
                    </div>
                </template>

                <!-- ================= 方案 5：圆润柔光胶囊 ================= -->
                <template v-else-if="designStyle === 'soft'">
                    <div
                        v-for="(item, idx) in [{name: '启用云端实时同步', desc: '超椭圆大圆角与温润柔和边界', val: subItem2, set: () => subItem2 = !subItem2}, {name: '生成 Markdown 格式快照', desc: '保存时生成快照', val: item4, set: () => item4 = !item4}]"
                        :key="idx"
                        class="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                        @click="item.set()"
                    >
                        <div class="box-soft shrink-0" :class="item.val ? 'box-soft-checked' : ''">
                            <span class="i-lucide-check icon-check" aria-hidden="true"></span>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-[13.5px] font-medium text-[var(--text-main)]">{{ item.name }}</span>
                            <span class="text-xs text-[var(--text-muted)]">{{ item.desc }}</span>
                        </div>
                    </div>
                </template>

                <!-- ================= 方案 6：科技霓虹发光 ================= -->
                <template v-else-if="designStyle === 'neon'">
                    <div
                        v-for="(item, idx) in [{name: '启用云端实时同步', desc: '高饱和外发光与科技呼吸感', val: subItem2, set: () => subItem2 = !subItem2}, {name: '生成 Markdown 格式快照', desc: '保存时生成快照', val: item4, set: () => item4 = !item4}]"
                        :key="idx"
                        class="group flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)] transition-colors cursor-pointer select-none"
                        @click="item.set()"
                    >
                        <div class="box-neon shrink-0" :class="item.val ? 'box-neon-checked' : ''">
                            <span class="i-lucide-check icon-check" aria-hidden="true"></span>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-[13.5px] font-medium text-[var(--text-main)]">{{ item.name }}</span>
                            <span class="text-xs text-[var(--text-muted)]">{{ item.desc }}</span>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
.scheme-banner {
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}
.scheme-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-pill);
    background: var(--accent-main);
    color: #ffffff;
    flex-shrink: 0;
}
.scheme-banner-text {
    font-size: var(--text-xs);
    color: var(--text-main);
    line-height: 1.4;
}

/* 紧凑 macOS 卡片容器 */
.macos-compact-card {
    width: 100%;
    max-width: 480px;
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

.stage-box {
    position: relative;
    width: 100%;
    margin-top: var(--space-2);
}

/* ============================================================
   方案 1：截图标准实心风（100% 对齐截图图二与图一）
   ============================================================ */
.box-screenshot {
    width: 20px;
    height: 20px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 140ms ease, transform 120ms ease;
}

.group:hover .box-screenshot {
    background: color-mix(in srgb, var(--text-main) 26%, transparent);
}

.box-screenshot-checked {
    background: var(--accent-main) !important;
}

.group:hover .box-screenshot-checked {
    background: color-mix(in srgb, var(--accent-main) 90%, #000000) !important;
}

/* 截图单选按钮 */
.radio-screenshot {
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-main) 18%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 140ms ease, transform 120ms ease;
}

.group:hover .radio-screenshot {
    background: color-mix(in srgb, var(--text-main) 26%, transparent);
}

.radio-screenshot-checked {
    background: var(--accent-main) !important;
}

/* ============================================================
   方案 2：macOS 原生微拟物（微反光 + 微内阴影 + 弹簧回弹）
   ============================================================ */
.box-macos {
    width: 18px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, var(--text-main) 22%, transparent);
    background: color-mix(in srgb, var(--bg-panel) 90%, transparent);
    box-shadow: inset 0 1px 1.5px color-mix(in srgb, var(--shadow-color) 12%, transparent),
                0 1px 2px color-mix(in srgb, var(--shadow-color) 6%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 140ms cubic-bezier(0.16, 1, 0.3, 1);
}

.group:hover .box-macos {
    border-color: color-mix(in srgb, var(--text-main) 38%, transparent);
    background: color-mix(in srgb, var(--bg-panel) 98%, transparent);
}

.box-macos-checked {
    border-color: var(--accent-main) !important;
    background: linear-gradient(180deg, var(--accent-main) 0%, color-mix(in srgb, var(--accent-main) 88%, #000000) 100%) !important;
    box-shadow: inset 0 1px 0.5px rgba(255, 255, 255, 0.45),
                0 2px 6px color-mix(in srgb, var(--accent-main) 38%, transparent) !important;
    animation: check-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.box-macos .icon-check {
    width: 12px;
    height: 12px;
    color: transparent;
    transition: color 100ms ease, transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transform: scale(0.6);
}

.box-macos-checked .icon-check {
    color: #ffffff !important;
    transform: scale(1);
}

@keyframes check-pop {
    0% { transform: scale(0.85); }
    50% { transform: scale(1.08); }
    100% { transform: scale(1); }
}

/* ============================================================
   方案 3：现代极简线条（1.5px 纯净线框 + 3px 呼吸光圈）
   ============================================================ */
.box-minimal {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1.5px solid color-mix(in srgb, var(--text-main) 30%, transparent);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 120ms ease;
}

.group:hover .box-minimal {
    border-color: var(--accent-main);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-main) 14%, transparent);
}

.box-minimal-checked {
    border-color: var(--accent-main) !important;
    background: var(--accent-main) !important;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-main) 16%, transparent) !important;
}

.box-minimal .icon-check {
    width: 12px;
    height: 12px;
    color: transparent;
}

.box-minimal-checked .icon-check {
    color: #ffffff !important;
}

/* ============================================================
   方案 4：磨砂交互卡片
   ============================================================ */
.card-row-unchecked {
    background: color-mix(in srgb, var(--bg-panel) 45%, transparent);
    border-color: color-mix(in srgb, var(--border-color) 60%, transparent);
}
.card-row-unchecked:hover {
    background: color-mix(in srgb, var(--bg-panel) 70%, transparent);
    border-color: color-mix(in srgb, var(--border-color) 90%, transparent);
}
.card-row-checked {
    background: color-mix(in srgb, var(--accent-main) 10%, var(--bg-panel));
    border-color: color-mix(in srgb, var(--accent-main) 35%, transparent);
    box-shadow: 0 4px 16px -2px color-mix(in srgb, var(--accent-main) 15%, transparent);
}

/* ============================================================
   方案 5：圆润柔光胶囊
   ============================================================ */
.box-soft {
    width: 20px;
    height: 20px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--text-main) 16%, transparent);
    background: color-mix(in srgb, var(--bg-hover) 80%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease;
}

.box-soft-checked {
    border-color: var(--accent-main) !important;
    background: color-mix(in srgb, var(--accent-main) 90%, #ffffff) !important;
    box-shadow: 0 4px 12px color-mix(in srgb, var(--accent-main) 30%, transparent);
}

.box-soft .icon-check {
    width: 13px;
    height: 13px;
    color: transparent;
}

.box-soft-checked .icon-check {
    color: #ffffff !important;
}

/* ============================================================
   方案 6：科技霓虹发光
   ============================================================ */
.box-neon {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    border: 1.5px solid color-mix(in srgb, var(--accent-main) 40%, transparent);
    background: color-mix(in srgb, var(--accent-main) 5%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 150ms ease;
}

.box-neon-checked {
    border-color: var(--accent-main) !important;
    background: var(--accent-main) !important;
    box-shadow: 0 0 12px var(--accent-main),
                0 0 2px #ffffff !important;
}

.box-neon .icon-check {
    width: 12px;
    height: 12px;
    color: transparent;
}

.box-neon-checked .icon-check {
    color: #ffffff !important;
}
</style>
