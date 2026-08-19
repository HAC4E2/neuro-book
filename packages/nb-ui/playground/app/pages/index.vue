<script setup lang="ts">
import {ref} from "vue";
import {useTheme} from "../composables/useTheme";
import {useColorway} from "../composables/useColorway";

const theme = useTheme();
const colorway = useColorway();

// ── 演示状态 ────────────────────────────────────────────────────────────────
const activeTab = ref("outline");
const viewMode = ref("write");
const chapter = ref("第 12 章 · 灰烬之前");
const summary = ref("裴照在旧档案馆找到母亲留下的第二封信，信里提到「灯塔」不是地名。");
const wordGoal = ref("2400");
const invalidGoal = ref("0");
const autosave = ref(true);
const publish = ref(false);
const activeChapterId = ref("c12");
/** 组件覆盖探针的 v-model。契约里 modelValue 是 "HH:mm" 字符串，不是 Date */
const reminderAt = ref<string | undefined>("09:30");

/** 下拉的 v-model。这一处是真组件，用来看浮层有没有吃到主题的玻璃 */
const pickedFormat = ref("markdown");
const formatOptions = [
    {label: "Markdown（.md）", value: "markdown"},
    {label: "纯文本（.txt）", value: "text"},
    {label: "Word 文档（.docx）", value: "docx"},
    {label: "EPUB 电子书", value: "epub"},
    {label: "PDF（暂不可用）", value: "pdf", disabled: true},
];

const chapters = [
    {id: "c10", label: "第 10 章 · 潮线", state: "done"},
    {id: "c11", label: "第 11 章 · 无人接听", state: "done"},
    {id: "c12", label: "第 12 章 · 灰烬之前", state: "writing"},
    {id: "c13", label: "第 13 章 · 未命名", state: "empty"},
];

const tabs = [
    {value: "outline", label: "大纲"},
    {value: "notes", label: "笔记"},
    {value: "history", label: "版本"},
];

const rows = [
    {name: "chapter-12.md", status: "写作中", tone: "warning", words: "1,842", time: "3 分钟前"},
    {name: "chapter-11.md", status: "已同步", tone: "success", words: "2,610", time: "昨天"},
    {name: "outline.md", status: "有冲突", tone: "danger", words: "764", time: "2 天前"},
];

const badges = [
    {tone: "neutral", label: "草稿"},
    {tone: "accent", label: "当前"},
    {tone: "success", label: "已同步"},
    {tone: "warning", label: "待审"},
    {tone: "danger", label: "冲突"},
    {tone: "info", label: "运行中"},
];
</script>

<template>
    <main class="sc-root min-h-full px-4 py-6">
        <div class="sc-page-shell mx-auto max-w-6xl">
            <div class="sc-page-content">
                <!-- ── 当前主题说明 ──────────────────────────────────────────── -->
                <section class="flex flex-col gap-3">
                    <div class="flex flex-wrap items-baseline gap-3">
                        <h1 class="sc-display">{{ theme.active.value?.manifest.name ?? "未装主题" }}</h1>
                        <span class="sc-secondary">{{ theme.active.value?.manifest.tagline }}</span>
                        <span class="sc-muted">
                            · 配色 {{ colorway.colorwayMeta[colorway.current.value]?.label ?? colorway.current.value }}
                        </span>
                    </div>
                    <p class="sc-secondary max-w-3xl">
                        {{ theme.active.value?.manifest.description ?? "一个主题都没装是受支持的状态：界面能用，只是没有设计感。" }}
                    </p>

                </section>


            <!-- ── ① 真实界面切片：这才是判断主题的主要依据 ───────────────────── -->
            <section class="flex flex-col gap-3">
                <h2 class="sc-title sc-secondary">① 界面切片 · 写作工作台</h2>

                <!--
                    窗口构造刻意照着真实 macOS 窗口来：工具栏和侧栏是导航层（玻璃，透出窗体底纹），
                    内容区是内容层（实心）。玻璃主题之外这些类是惰性的，看起来和原来一样。

                    镜面高光（sc-rim）挂在**窗口**上而不是各个分区上：一块玻璃的边属于整块玻璃。
                    挂到分区上会得到几圈方角高光，在窗口的圆角处被斜切——上一版就是这个毛病。
                -->
                <div class="sc-window sc-rim">
                    <div class="sc-toolbar sc-glass">
                        <div class="sc-seg" role="group">
                            <button
                                v-for="m in [
                                    {v: 'write', l: '写作'},
                                    {v: 'plot', l: '剧情'},
                                    {v: 'review', l: '审阅'},
                                ]"
                                :key="m.v"
                                type="button"
                                class="sc-seg__item"
                                :aria-pressed="viewMode === m.v"
                                @click="viewMode = m.v"
                            >
                                {{ m.l }}
                            </button>
                        </div>

                        <div class="sc-secondary flex items-center gap-2">
                            <span class="i-lucide-file-text h-4 w-4"></span>
                            <span>{{ chapter }}</span>
                            <span class="sc-badge sc-badge--warning"><span class="sc-dot"></span>未保存</span>
                        </div>

                        <div class="ml-auto flex items-center gap-1">
                            <button class="sc-icon-btn" title="搜索"><span class="i-lucide-search h-4 w-4"></span></button>
                            <button class="sc-icon-btn" title="历史"><span class="i-lucide-history h-4 w-4"></span></button>
                            <button class="sc-icon-btn" title="设置"><span class="i-lucide-settings h-4 w-4"></span></button>
                            <button class="sc-btn sc-btn--primary sc-btn--sm">
                                <span class="i-lucide-sparkles h-4 w-4"></span>续写
                            </button>
                        </div>
                    </div>

                    <div class="grid gap-0 md:grid-cols-[220px_1fr_260px]">
                        <!-- 章节列表 -->
                        <div class="sc-sidebar sc-glass p-4" style="border-right: var(--border-w) solid var(--divider)">
                            <div class="sc-muted mb-3">章节</div>
                            <div class="sc-list">
                                <div
                                    v-for="c in chapters"
                                    :key="c.id"
                                    class="sc-list__item"
                                    :aria-current="activeChapterId === c.id"
                                    @click="activeChapterId = c.id"
                                >
                                    <span
                                        class="h-4 w-4 shrink-0"
                                        :class="c.state === 'empty' ? 'i-lucide-file-plus' : 'i-lucide-file-text'"
                                    ></span>
                                    <span class="truncate">{{ c.label }}</span>
                                </div>
                            </div>
                        </div>

                        <!-- 属性表单 -->
                        <div class="sc-content sc-panel__body">
                            <div class="sc-tabs">
                                <button
                                    v-for="t in tabs"
                                    :key="t.value"
                                    type="button"
                                    class="sc-tab"
                                    :aria-selected="activeTab === t.value"
                                    @click="activeTab = t.value"
                                >
                                    {{ t.label }}
                                </button>
                            </div>

                            <div class="sc-field">
                                <label class="sc-label" for="f-title">标题</label>
                                <input id="f-title" v-model="chapter" class="sc-input" />
                            </div>

                            <div class="sc-field">
                                <label class="sc-label" for="f-sum">一句话梗概</label>
                                <textarea id="f-sum" v-model="summary" class="sc-textarea"></textarea>
                                <span class="sc-hint">用于生成续写提示，建议不超过两行。</span>
                            </div>

                            <div class="grid gap-4 sm:grid-cols-2">
                                <div class="sc-field">
                                    <label class="sc-label" for="f-goal">字数目标</label>
                                    <input id="f-goal" v-model="wordGoal" class="sc-input" />
                                </div>
                                <div class="sc-field">
                                    <label class="sc-label" for="f-bad">字数目标（错误态）</label>
                                    <input id="f-bad" v-model="invalidGoal" class="sc-input sc-input--invalid" />
                                    <span class="sc-error">目标必须大于 0。</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-6">
                                <div class="sc-switch" role="switch" :aria-checked="autosave" @click="autosave = !autosave">
                                    <span class="sc-switch__track"><span class="sc-switch__thumb"></span></span>
                                    <span>自动保存</span>
                                </div>
                                <div class="sc-switch" role="switch" :aria-checked="publish" @click="publish = !publish">
                                    <span class="sc-switch__track"><span class="sc-switch__thumb"></span></span>
                                    <span>发布到站点</span>
                                </div>
                            </div>
                        </div>

                        <!-- 状态面板 -->
                        <div class="sc-sidebar sc-glass p-4" style="border-left: var(--border-w) solid var(--divider)">
                            <div class="sc-muted mb-3">本章状态</div>
                            <div class="flex flex-wrap gap-2">
                                <span v-for="b in badges" :key="b.label" class="sc-badge" :class="`sc-badge--${b.tone}`">
                                    <span class="sc-dot"></span>{{ b.label }}
                                </span>
                            </div>
                            <hr class="sc-divider my-4" />
                            <div class="sc-secondary flex flex-col gap-2">
                                <div class="flex justify-between"><span>字数</span><span class="sc-mono">1,842</span></div>
                                <div class="flex justify-between"><span>伏笔</span><span class="sc-mono">3 未回收</span></div>
                                <div class="flex justify-between"><span>上次同步</span><span class="sc-mono">3 分钟前</span></div>
                            </div>
                            <hr class="sc-divider my-4" />
                            <button class="sc-btn w-full"><span class="i-lucide-git-compare h-4 w-4"></span>对比上一版</button>
                        </div>
                    </div>
                </div>
            </section>

            <!-- ── ② 元素对照 ────────────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h2 class="sc-title sc-secondary">② 元素对照</h2>
                <div class="grid gap-4 md:grid-cols-2">
                    <div class="sc-panel">
                        <div class="sc-panel__head"><span class="sc-title">按钮</span></div>
                        <div class="sc-panel__body">
                            <div class="flex flex-wrap items-center gap-3">
                                <button class="sc-btn sc-btn--primary">主操作</button>
                                <button class="sc-btn">次操作</button>
                                <button class="sc-btn sc-btn--ghost">幽灵</button>
                                <button class="sc-btn sc-btn--danger">删除</button>
                                <button class="sc-btn" disabled>禁用</button>
                            </div>
                            <div class="flex flex-wrap items-center gap-3">
                                <button class="sc-btn sc-btn--sm">小</button>
                                <button class="sc-btn">中</button>
                                <button class="sc-btn sc-btn--lg">大</button>
                                <button class="sc-icon-btn"><span class="i-lucide-plus h-4 w-4"></span></button>
                                <span class="sc-muted">Tab 聚焦看焦点环</span>
                            </div>
                        </div>
                    </div>

                    <div class="sc-panel">
                        <div class="sc-panel__head"><span class="sc-title">输入与选择</span></div>
                        <div class="sc-panel__body">
                            <input class="sc-input" placeholder="常态 · placeholder" />
                            <!--
                                这一处是**真的 nb-ui 组件**，不是 showcase 手写标记。
                                原来是原生 <select>，弹出列表由操作系统绘制，主题一点也够不着。
                                摆在这里就是为了能点开看浮层是不是吃到了主题的玻璃。
                            -->
                            <FormSelect v-model="pickedFormat" :options="formatOptions" />
                            <div class="flex flex-wrap items-center gap-3">
                                <span class="sc-kbd">⌘</span><span class="sc-kbd">K</span>
                                <span class="sc-muted">键帽借用控件描边与凹凸配方</span>
                            </div>
                            <div class="flex items-center gap-3">
                                <span class="sc-tooltip">提示气泡</span>
                                <span class="sc-muted">浮层用 --elevation-popover</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!--
                    组件覆盖的现场证据。这一块是**真的 nb-ui 组件**，不是 showcase 手写标记——
                    页面其余部分之所以手写，是因为现有 28 个组件把刻度硬编码在模板里；
                    TimePicker 是阶段 2 之后的写法，从第一天就消费 token，所以敢放在这里。

                    切到 macOS 主题它会变成滚轮，其余四套是下拉列表。两者 v-model 与键盘完全一致，
                    换的是实现不是契约——这是「主题能提供组件实现」这条能力唯一看得见的地方。
                -->
                <div class="sc-panel" data-nb-override-probe>
                    <div class="sc-panel__head">
                        <span class="sc-title">组件覆盖：时间选择器</span>
                        <span class="sc-muted">macOS 主题下换成滚轮，其余主题用库默认的下拉列表</span>
                    </div>
                    <div class="sc-panel__body">
                        <div class="flex flex-wrap items-start gap-4">
                            <div style="width: 220px">
                                <TimePicker v-model="reminderAt" :step="30" min="06:00" max="23:00" />
                            </div>
                            <span class="sc-muted">当前值 {{ reminderAt ?? "（未选）" }} · ↑↓ 调整、Enter 开合、Esc 回滚</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- ── ③ 数据与浮层 ──────────────────────────────────────────────── -->
            <section class="flex flex-col gap-3">
                <h2 class="sc-title sc-secondary">③ 数据与浮层</h2>
                <!--
                    菜单刻意**压在表格上**：Liquid Glass 的折射只有在背后有细节时才看得出来，
                    浮在平滑渐变上几乎为零。真实的菜单本来就是浮在内容之上的，这样摆也更诚实。
                -->
                <div class="relative grid gap-4 md:grid-cols-[1fr_320px]">
                    <div class="sc-panel">
                        <table class="sc-table">
                            <thead>
                                <tr><th>文件</th><th>状态</th><th>字数</th><th>更新</th></tr>
                            </thead>
                            <tbody>
                                <tr v-for="r in rows" :key="r.name">
                                    <td class="sc-mono">{{ r.name }}</td>
                                    <td><span class="sc-badge" :class="`sc-badge--${r.tone}`"><span class="sc-dot"></span>{{ r.status }}</span></td>
                                    <td class="sc-mono">{{ r.words }}</td>
                                    <td>{{ r.time }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div class="sc-popover sc-glass sc-glass--strong sc-rim absolute left-[22%] top-8 z-10 w-56">
                        <div class="sc-popover__item"><span class="i-lucide-copy h-4 w-4"></span>复制</div>
                        <div class="sc-popover__item"><span class="i-lucide-download h-4 w-4"></span>导出</div>
                        <div class="sc-popover__item" style="color: var(--status-danger)">
                            <span class="i-lucide-trash-2 h-4 w-4"></span>删除
                        </div>
                    </div>

                    <div class="sc-panel">
                        <div class="sc-empty">
                            <span class="i-lucide-search-x h-6 w-6"></span>
                            <span class="sc-title">没有匹配的结果</span>
                            <span class="sc-muted">空态用来看留白节奏是否成立</span>
                        </div>
                    </div>
                </div>

                <div class="sc-dialog sc-glass sc-glass--strong sc-rim" style="max-width: 460px">
                    <div class="sc-dialog__head">
                        <span class="sc-title">放弃本次修改？</span>
                        <button class="sc-icon-btn"><span class="i-lucide-x h-4 w-4"></span></button>
                    </div>
                    <div class="sc-dialog__body">未保存的段落会丢失，且无法恢复。</div>
                    <div class="sc-dialog__foot">
                        <button class="sc-btn">取消</button>
                        <button class="sc-btn sc-btn--danger">放弃修改</button>
                    </div>
                </div>
            </section>
            </div>
        </div>
    </main>
</template>
