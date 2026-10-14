<script setup lang="ts">
import {Button} from "@notnotype/nb-ui/components";
import {Terminal} from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {letBrowserCopy, sanitizePaste} from "../host/terminal-input.js";
import {TERMINAL_FONT_FALLBACK} from "../host/terminal-font.js";
import type {TerminalFrame, TerminalSource} from "../host/terminal-socket.js";
import {applyTerminalScope, measureCellRatio, readTerminalFont, readTerminalTheme} from "../host/terminal-theme.js";

/** 会话的实时终端：观看只读，接管时键盘直通；契约见同名 .md。 */
const props = withDefaults(defineProps<{
    source: TerminalSource;
    mode: "watch" | "control";
    cols: number;
    rows: number;
    sizeKnown: boolean;
    bracketedPaste: boolean;
    canTakeover: boolean;
    takeoverBlocked: string | null;
    controllerNote?: string | null;
    pending?: boolean;
}>(), {controllerNote: null, pending: false});
const emit = defineEmits<{takeover: [cols: number, rows: number]; release: []; input: [data: string, paste: boolean]; resize: [cols: number, rows: number]; "open-link": [url: string]}>();

const CONTROL_FONT = 13;
/** 观看时字号的范围：再窄的容器（手机的终端画面）也尽量放下整屏，放不下就在框里横向滚动。 */
const WATCH_FONT_MIN = 5;
const WATCH_FONT_MAX = 14;
/** 接管时终端框的高度（观看时框高随行数）。接管尺寸按这个高度算，接上之后不必再 resize 一次。 */
const CONTROL_BOX = {height: "70vh", minHeight: "16rem"} as const;
const host = ref<HTMLDivElement | null>(null);
const frameBox = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let unsubscribe: (() => void) | null = null;
let observer: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let pasting = false;
/** 一格的宽度与字号之比，挂载时按实际字体量（拿不到时按等宽字常见的 0.6）。 */
let cellRatio = 0.6;

/** 观看时字号按容器宽度与列数缩放，控制在 `WATCH_FONT_MIN` 到 `WATCH_FONT_MAX`。 */
function watchFontSize(cols: number): number {
    const width = frameBox.value?.clientWidth ?? 800;
    return Math.max(WATCH_FONT_MIN, Math.min(WATCH_FONT_MAX, Math.floor((width - 16) / (cols * cellRatio))));
}

function fitWatchFont(): void {
    if (!term || props.mode !== "watch") return;
    const size = watchFontSize(term.cols);
    if (term.options.fontSize !== size) term.options.fontSize = size;
}

function onFrame(frame: TerminalFrame): void {
    if (!term) return;
    if (term.cols !== frame.w || term.rows !== frame.h) term.resize(frame.w, frame.h);
    fitWatchFont();
    term.write(frame.bytes);
}

/**
 * xterm 的渲染尺寸（私有字段）。`@xterm/addon-fit` 读的也是这个对象，不过它读 `css.cell`；这里读 `device.cell`。
 * 升级 xterm 时要核对：`device.cell` 仍是不随列数变的一格（设备像素），见同名 .md。
 */
type XtermRenderDimensions = {_core: {_renderService: {dimensions: {device: {cell: {width: number; height: number}}}}}};

/**
 * 按框量终端放得下多少列、多少行，结果只取决于框的尺寸与字号，量几次都一样：
 * - 一格的宽高用 `device.cell` 除以 dpr，不用 fit 的 `css.cell`。xterm 的 DOM 渲染器先把整屏宽度取整再除回列数，`css.cell` 随当前列数变：
 *   13px 时字宽 6.5，当前列数是奇数时格宽进位、量出的列数少 1，接上之后变成偶数列，再量又多 1，于是又 resize 一次；
 * - 量的时候先把框的溢出藏起来：框里还是旧尺寸的画面时，13px 下可能溢出、出滚动条，桌面浏览器的滚动条占位，把内容区挤掉一行几列
 *   （无头 Chrome 缺省不画滚动条，验收时要带上它才看得出）。
 * 改动都在同一个同步块里改回，中间不会画到屏幕上。
 */
function proposeSize(box: HTMLElement): {cols: number; rows: number} | null {
    const element = term?.element;
    const parent = element?.parentElement;
    if (!term || !element || !parent) return null;
    const cell = (term as unknown as XtermRenderDimensions)._core._renderService.dimensions.device.cell;
    const dpr = window.devicePixelRatio || 1;
    if (!(cell.width > 0 && cell.height > 0)) return null;
    const overflow = box.style.overflow;
    box.style.overflow = "hidden";
    const outer = getComputedStyle(parent);
    const inner = getComputedStyle(element);
    const width = Math.max(0, parseInt(outer.width)) - parseInt(inner.paddingLeft) - parseInt(inner.paddingRight);
    const height = parseInt(outer.height) - parseInt(inner.paddingTop) - parseInt(inner.paddingBottom);
    box.style.overflow = overflow;
    return {cols: Math.max(2, Math.floor(width / (cell.width / dpr))), rows: Math.max(1, Math.floor(height / (cell.height / dpr)))};
}

/** 按接管后的样子量：框临时套上接管时的高度、字号换成 13px，量完同步改回（中间不会画到屏幕上）。 */
function proposeControlSize(): {cols: number; rows: number} | null {
    const box = frameBox.value;
    if (!term || !box) return null;
    const before = {fontSize: term.options.fontSize, height: box.style.height, minHeight: box.style.minHeight};
    box.style.height = CONTROL_BOX.height;
    box.style.minHeight = CONTROL_BOX.minHeight;
    term.options.fontSize = CONTROL_FONT;
    const proposed = proposeSize(box);
    term.options.fontSize = before.fontSize;
    box.style.height = before.height;
    box.style.minHeight = before.minHeight;
    return proposed;
}

function requestTakeover(): void {
    const size = proposeControlSize();
    if (size) emit("takeover", size.cols, size.rows);
}

onMounted(() => {
    const element = host.value!;
    applyTerminalScope(frameBox.value!);
    let fontFamily = readTerminalFont(frameBox.value!);
    let ratio = measureCellRatio(fontFamily);
    if (ratio === null) {
        console.warn(`终端字体串不被 canvas 接受，改用缺省的等宽字体：${fontFamily}`);
        fontFamily = TERMINAL_FONT_FALLBACK;
        ratio = measureCellRatio(fontFamily);
    }
    if (ratio !== null && ratio > 0) cellRatio = ratio;
    term = new Terminal({
        scrollback: 0,
        disableStdin: props.mode !== "control",
        cursorBlink: false,
        fontFamily,
        fontSize: CONTROL_FONT,
        theme: readTerminalTheme(frameBox.value!),
        linkHandler: {
            activate: (_event, text) => {
                if (/^https?:\/\//iu.test(text)) emit("open-link", text);
            },
        },
    });
    term.open(element);
    if (props.bracketedPaste) term.write("\u001b[?2004h");
    term.attachCustomKeyEventHandler((event) => !letBrowserCopy(event, term?.hasSelection() ?? false));
    term.onData((data) => {
        if (props.mode === "control") emit("input", data, pasting);
    });
    // 粘贴先清洗再交给 xterm（它按本地的 bracketed paste 模式决定包不包）。
    element.addEventListener("paste", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (props.mode !== "control" || !term) return;
        const text = sanitizePaste(event.clipboardData?.getData("text/plain") ?? "");
        if (text === "") return;
        pasting = true;
        term.paste(text);
        pasting = false;
    }, {capture: true});
    unsubscribe = props.source.subscribe(onFrame);
    observer = new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeTimer = null;
            if (props.mode === "watch") return fitWatchFont();
            if (!term || !frameBox.value) return;
            const size = proposeSize(frameBox.value);
            if (size && (size.cols !== props.cols || size.rows !== props.rows)) emit("resize", size.cols, size.rows);
        }, 150);
    });
    observer.observe(frameBox.value!);
});

watch(() => props.mode, (mode) => {
    if (!term) return;
    term.options.disableStdin = mode !== "control";
    if (mode === "control") {
        term.options.fontSize = CONTROL_FONT;
        term.focus();
    } else {
        fitWatchFont();
    }
});
watch(() => props.bracketedPaste, (on) => term?.write(on ? "\u001b[?2004h" : "\u001b[?2004l"));

onBeforeUnmount(() => {
    unsubscribe?.();
    observer?.disconnect();
    if (resizeTimer) clearTimeout(resizeTimer);
    term?.dispose();
    term = null;
});

const sizeLabel = computed(() => `${props.cols}×${props.rows}`);
</script>

<template>
    <section class="flex flex-col gap-2" aria-label="实时终端">
        <div class="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] px-3 py-2" :style="{background: mode === 'control' ? 'var(--accent-bg)' : 'var(--bg-hover)', fontSize: 'var(--text-xs)'}">
            <template v-if="mode === 'watch'">
                <span class="i-lucide-eye size-4" aria-hidden="true" />
                <span class="min-w-0 flex-1"><b>观看中</b>：只读的实时画面，键盘在别处（herdr 客户端或其它设备）<template v-if="!sizeKnown">；尺寸不确定，可能裁切</template><template v-if="controllerNote">；{{ controllerNote }}</template></span>
                <Button v-if="canTakeover" size="sm" variant="primary" icon-class="i-lucide-keyboard" :loading="pending" @click="requestTakeover">接管键盘</Button>
                <span class="nbdev-empty" v-else>{{ takeoverBlocked }}</span>
            </template>
            <template v-else>
                <span class="i-lucide-keyboard size-4" aria-hidden="true" />
                <span class="min-w-0 flex-1"><b>你已接管键盘</b>：按键原样发给会话；终端按网页尺寸 {{ sizeLabel }}；切到别的标签页或离开会自动释放</span>
                <Button size="sm" variant="secondary" :loading="pending" @click="emit('release')">释放</Button>
            </template>
        </div>
        <p class="nbdev-caption" v-if="mode === 'control'">浏览器会拦下 Ctrl+W、Ctrl+T、Ctrl+N（删词用 Alt+Backspace）；有选中的文字时 Ctrl+C 是复制。herdr 那边（键盘与其它程序）照样能写进来。</p>
        <div ref="frameBox" class="overflow-x-auto rounded-[var(--radius-panel)] p-2" :style="{background: 'var(--bg-main)', ...(mode === 'control' ? CONTROL_BOX : {})}">
            <div ref="host" class="h-full" />
        </div>
    </section>
</template>
