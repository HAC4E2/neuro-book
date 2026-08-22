<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import Button from "../../../../src/components/controls/Button.vue";
import Dropdown from "../../../../src/components/controls/Dropdown.vue";
import IconButton from "../../../../src/components/controls/IconButton.vue";
import SegmentedControl from "../../../../src/components/controls/SegmentedControl.vue";
import Badge from "../../../../src/components/display/Badge.vue";
import FormCheckbox from "../../../../src/components/form/FormCheckbox.vue";
import FormInput from "../../../../src/components/form/FormInput.vue";
import FormNumberInput from "../../../../src/components/form/FormNumberInput.vue";
import FormSelect from "../../../../src/components/form/FormSelect.vue";
import FixtureShell from "../FixtureShell.vue";
import {controlDefaultValue, type LabComponentDefinition} from "../registry";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
}>();

const emit = defineEmits<{
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

// 4 种基于方案 2（纯色实心体系）的衍生方案
const selectedSubScheme = ref<"scheme2a" | "scheme2b" | "scheme2c" | "scheme2d">("scheme2b");
const subSchemeOptions = [
    {label: "2-B: 超椭圆 (已选)", value: "scheme2b"},
    {label: "2-A: 原生胶囊", value: "scheme2a"},
    {label: "2-C: 柔光微影", value: "scheme2c"},
    {label: "2-D: 渐变立体", value: "scheme2d"},
];

// 表单联动数据
const chapterTitle = ref("第一章：神经连接与意识潜流");
const targetWordCount = ref("6000");
const selectedVolume = ref("vol1");
const volumeOptions = [
    {label: "第一卷：深渊苏醒", value: "vol1", iconClass: "i-lucide-book-open", description: "连载中"},
    {label: "第二卷：机械黎明", value: "vol2", iconClass: "i-lucide-book", description: "大纲草案"},
    {label: "外传：赛博夜雨档案", value: "vol3", iconClass: "i-lucide-file-text", description: "番外篇"},
];

const publishStatus = ref("draft");
const publishOptions = [
    {label: "私密草稿", value: "draft", iconClass: "i-lucide-lock"},
    {label: "协同审阅", value: "review", iconClass: "i-lucide-users"},
    {label: "公开发布", value: "published", iconClass: "i-lucide-globe"},
];

const autoBackup = ref(true);
const aiAssist = ref(true);
const branchPlot = ref(false);

const isSaving = ref(false);
const saveFeedback = ref("");

function handleSave(): void {
    isSaving.value = true;
    saveFeedback.value = "";
    setTimeout(() => {
        isSaving.value = false;
        saveFeedback.value = "全部更改已同步！";
        setTimeout(() => { saveFeedback.value = ""; }, 3000);
    }, 600);
}

// 更多操作下拉菜单项
const dropdownItems = [
    {label: "创建历史快照版本", value: "snapshot", iconClass: "i-lucide-history"},
    {label: "导出为 Markdown...", value: "export", iconClass: "i-lucide-download"},
    {label: "锁定当前章节", value: "lock", iconClass: "i-lucide-lock"},
    {label: "", value: "sep-1", separator: true},
    {label: "移入废纸篓", value: "delete", iconClass: "i-lucide-trash-2", tone: "danger" as const},
];

const controls = ref<Record<string, string | boolean>>({});

function resetState(): void {
    const defaults: Record<string, string | boolean> = {};
    for (const control of props.definition.controls) defaults[control.id] = controlDefaultValue(control);
    controls.value = defaults;
}

watch(() => [props.definition.id, props.sceneId], () => {
    resetState();
    void nextTick(() => emit("rendered"));
}, {immediate: true});

onMounted(() => void nextTick(() => emit("rendered")));
</script>

<template>
    <FixtureShell v-model:controls="controls" :definition="definition" :scene-id="sceneId">
        <!-- 紧凑高质感 macOS 工作区卡片 -->
        <div class="macos-compact-card">
            <!-- 卡片顶部工具栏：标题、徽章与操作按钮 -->
            <div class="flex items-center justify-between gap-3 pb-3.5 mb-4 border-b border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                <div class="flex items-center gap-2.5 flex-wrap">
                    <h3 class="text-sm font-bold text-[var(--text-main)]">章节属性与设定</h3>

                    <!-- 动态徽章展示：已同步与温润深琥珀未保存改动 -->
                    <template v-if="selectedSubScheme === 'scheme2b'">
                        <Badge tone="success" icon-class="i-lucide-check-circle-2" size="sm">已同步</Badge>
                        <Badge tone="warning" icon-class="i-lucide-alert-circle" size="sm">未保存改动</Badge>
                        <Badge tone="neutral" size="sm">v1.4.2</Badge>
                    </template>
                    <template v-else-if="selectedSubScheme === 'scheme2a'">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-[var(--status-success)] shadow-sm">
                            <span class="i-lucide-check-circle-2 h-3 w-3"></span> 已同步
                        </span>
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-[#B45309] shadow-sm">
                            <span class="i-lucide-alert-circle h-3 w-3"></span> 未保存改动
                        </span>
                    </template>
                    <template v-else-if="selectedSubScheme === 'scheme2c'">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-[var(--status-success)] shadow-[0_2px_8px_color-mix(in_srgb,var(--status-success)_45%,transparent)]">
                            <span class="i-lucide-check-circle-2 h-3 w-3"></span> 已同步
                        </span>
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-[#B45309] shadow-[0_2px_8px_rgba(180,83,9,0.4)]">
                            <span class="i-lucide-alert-circle h-3 w-3"></span> 未保存改动
                        </span>
                    </template>
                    <template v-else-if="selectedSubScheme === 'scheme2d'">
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-gradient-to-b from-[#10B981] to-[#047857] shadow-[0_1px_3px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.3)]">
                            <span class="i-lucide-check-circle-2 h-3 w-3"></span> 已同步
                        </span>
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold text-white bg-gradient-to-b from-[#D97706] to-[#92400E] shadow-[0_1px_3px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.3)]">
                            <span class="i-lucide-alert-circle h-3 w-3"></span> 未保存改动
                        </span>
                    </template>
                </div>

                <!-- 头部右侧操作区（Dropdown 触发器 + IconButton） -->
                <div class="flex items-center gap-1.5 shrink-0">
                    <IconButton title="查看历史版本" variant="default" size="sm">
                        <span class="i-lucide-history text-xs"></span>
                    </IconButton>

                    <Dropdown
                        :items="dropdownItems"
                        menu-class="min-w-[180px]"
                    >
                        <IconButton title="更多选项" variant="default" size="sm">
                            <span class="i-lucide-more-horizontal text-xs"></span>
                        </IconButton>
                    </Dropdown>
                </div>
            </div>

            <!-- 方案切换紧凑胶囊条 -->
            <div class="mb-4 flex items-center justify-between p-2 rounded-lg bg-[var(--bg-main)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)]">
                <span class="text-xs text-[var(--text-muted)] font-medium">Badge 方案预览：</span>
                <SegmentedControl
                    v-model="selectedSubScheme"
                    :options="subSchemeOptions"
                    size="xs"
                />
            </div>

            <!-- 表单正文字段区 -->
            <div class="flex flex-col gap-4">
                <!-- 字段 1：章节标题 (FormInput) -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-semibold text-[var(--text-main)] flex items-center justify-between">
                        <span>章节标题</span>
                        <span class="text-[11px] text-[var(--text-muted)] font-normal">支持 Markdown</span>
                    </label>
                    <FormInput
                        v-model="chapterTitle"
                        placeholder="请输入章节标题..."
                        size="md"
                    />
                </div>

                <!-- 字段 2 & 3 双列：所属卷册 (FormSelect) 与 目标字数 (FormNumberInput) -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div class="flex flex-col gap-1.5">
                        <label class="text-xs font-semibold text-[var(--text-main)]">所属卷册</label>
                        <FormSelect
                            v-model="selectedVolume"
                            :options="volumeOptions"
                            size="default"
                        />
                    </div>

                    <div class="flex flex-col gap-1.5">
                        <label class="text-xs font-semibold text-[var(--text-main)] flex items-center justify-between">
                            <span>目标字数</span>
                            <span class="font-mono text-[11px] text-[var(--accent-main)]">4,820 / {{ targetWordCount }}</span>
                        </label>
                        <FormNumberInput
                            v-model="targetWordCount"
                            min="500"
                            max="50000"
                            step="500"
                            size="default"
                        />
                    </div>
                </div>

                <!-- 字段 4：发布范围 (SegmentedControl) -->
                <div class="flex flex-col gap-1.5">
                    <label class="text-xs font-semibold text-[var(--text-main)]">公开范围与权限</label>
                    <div class="flex">
                        <SegmentedControl
                            v-model="publishStatus"
                            :options="publishOptions"
                            size="sm"
                        />
                    </div>
                </div>

                <!-- 字段 5：开关选项组 (FormCheckbox 饱满超椭圆) -->
                <div class="flex flex-col gap-3 p-3.5 rounded-xl bg-[var(--bg-main)] border border-[color-mix(in_srgb,var(--border-color)_70%,transparent)]">
                    <span class="text-xs font-semibold text-[var(--text-main)]">自动化与辅助设定</span>

                    <FormCheckbox v-model="autoBackup">
                        <span class="text-xs font-medium text-[var(--text-main)]">启用云端实时快照备份</span>
                        <span class="text-[11px] text-[var(--text-muted)]">每 5 分钟自动创建分支快照</span>
                    </FormCheckbox>

                    <FormCheckbox v-model="aiAssist">
                        <span class="text-xs font-medium text-[var(--text-main)]">启用 AI 语境感知与续写建议</span>
                        <span class="text-[11px] text-[var(--text-muted)]">写作时提供行内灰色灵感补全</span>
                    </FormCheckbox>

                    <FormCheckbox v-model="branchPlot">
                        <span class="text-xs font-medium text-[var(--text-main)]">包含多结局分支剧情走向</span>
                        <span class="text-[11px] text-[var(--text-muted)]">为当前章节启用交互式选择树</span>
                    </FormCheckbox>
                </div>

                <!-- 底部操作区 (Button 组) -->
                <div class="flex items-center justify-between pt-2.5 border-t border-[color-mix(in_srgb,var(--border-color)_60%,transparent)]">
                    <span class="text-xs text-[var(--status-success)] font-medium transition-opacity" :class="saveFeedback ? 'opacity-100' : 'opacity-0'">
                        ✓ {{ saveFeedback }}
                    </span>

                    <div class="flex items-center gap-2.5">
                        <Button variant="secondary" size="md">
                            放弃修改
                        </Button>
                        <Button
                            variant="primary"
                            size="md"
                            :loading="isSaving"
                            @click="handleSave"
                        >
                            <span class="i-lucide-save" aria-hidden="true"></span>
                            {{ isSaving ? "同步中..." : "保存设定" }}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    </FixtureShell>
</template>

<style scoped>
/* 紧凑 macOS 容器卡片 */
.macos-compact-card {
    width: 100%;
    max-width: 540px;
    margin: 0 auto;
    padding: var(--space-5) var(--space-6);
    border-radius: 14px;
    background: color-mix(in srgb, var(--bg-panel) 85%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
    box-shadow: 0 20px 48px -12px color-mix(in srgb, var(--shadow-color) 24%, transparent),
                0 2px 8px color-mix(in srgb, var(--shadow-color) 8%, transparent);
}
</style>
