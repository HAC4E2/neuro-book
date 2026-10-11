/**
 * Lab 的只读调试接口，挂在 `window.__nbLab`，给截图脚本和浏览器控制台用。
 *
 * 脚本只认这里和 `data-lab-stage` 标记，不认 Lab 外壳的按钮文字或 class：外壳改版时脚本不必跟着改。
 * 接口只读，改状态一律走 URL 参数（见 lab-url.ts），保证同一个 URL 永远是同一个起点。
 */
import type {LabClippedFocus, LabDebugApi, LabOverflowOffender, LabStageMeasure} from "../shared/debug-api";

import {describeNode} from "./inspect";

declare global {
    interface Window {
        __nbLab?: LabDebugApi;
    }
}

const TOLERANCE = 1;
const MAX_OFFENDERS = 20;

/**
 * 看不见的元素不算越界：读屏用的播报区（`opacity: 0`）、视觉隐藏的原生输入（`clip: rect(0 0 0 0)` 或
 * `clip-path: inset(50%)`）与 `visibility: hidden`。它们常被组件库放在盒子外面，算进来就是误报。
 */
function invisible(element: HTMLElement): boolean {
    const style = getComputedStyle(element);
    return style.opacity === "0" || style.visibility === "hidden" || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
}

/** 元素和舞台之间有没有横向不外溢的容器把它挡住：挡住的越界看不见，也不会撑出滚动条。 */
function clipped(element: HTMLElement, stage: HTMLElement): boolean {
    for (let node = element.parentElement; node !== null && node !== stage; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX !== "visible") {
            return true;
        }
    }
    return false;
}

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='combobox'], [role='listbox']";

/**
 * 主题焦点环的外扩量：`--focus-ring` 是几层 box-shadow，取每层“偏移 + 模糊 + 扩散”的最大值。
 * 读不到或解析不出时按 7px（nbook、macos 两套主题都是 1 + 3.5 两圈加 1px 偏移 6px 模糊）。
 */
export function focusRingExtent(element: Element): number {
    const value = getComputedStyle(element).getPropertyValue("--focus-ring").trim();
    if (value === "") return 7;
    let extent = 0;
    // 按顶层逗号拆层：颜色里的 color-mix(...) 自带逗号，括号内不拆。
    let depth = 0;
    let start = 0;
    const layers: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
        else if (char === "," && depth === 0) {
            layers.push(value.slice(start, index));
            start = index + 1;
        }
    }
    layers.push(value.slice(start));
    for (const layer of layers) {
        const lengths = layer.match(/-?\d*\.?\d+px/gu)?.map((part) => Number.parseFloat(part)) ?? [];
        if (lengths.length < 2) continue;
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
        extent = Math.max(extent, Math.max(Math.abs(x), Math.abs(y)) + blur + spread);
    }
    return extent > 0 ? extent : 7;
}

/**
 * 聚焦光晕会被裁的控件：沿祖先往上找 overflow 不为 visible 的容器，控件任一边离容器内容盒的边不足光晕外扩量就算。
 * 不真的去聚焦（会改页面状态、触发监听），按主题 token 的几何算；控件本身就越出容器的归溢出检查，这里跳过。
 */
export function clippedFocusRings(stage: HTMLElement, extent: number): LabClippedFocus[] {
    const found: LabClippedFocus[] = [];
    for (const element of stage.querySelectorAll<HTMLElement>(FOCUSABLE)) {
        if (found.length >= MAX_OFFENDERS) break;
        if (invisible(element) || (element as HTMLButtonElement).disabled) continue;
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        for (let node = element.parentElement; node !== null && node !== stage; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.overflowX === "visible" && style.overflowY === "visible") continue;
            const inner = node.getBoundingClientRect();
            const inset = {
                left: Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft) * 0,
                top: Number.parseFloat(style.borderTopWidth),
                right: Number.parseFloat(style.borderRightWidth),
                bottom: Number.parseFloat(style.borderBottomWidth),
            };
            // 可滚动的方向上，容器边不是裁切边（内容滚过去就露出来），只看不滚动的那个轴。
            const scrollsX = (style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth;
            const scrollsY = (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight;
            const gaps = [
                ...(style.overflowX === "visible" || scrollsX ? [] : [box.left - (inner.left + inset.left), inner.right - inset.right - box.right]),
                ...(style.overflowY === "visible" || scrollsY ? [] : [box.top - (inner.top + inset.top), inner.bottom - inset.bottom - box.bottom]),
            ];
            const gap = Math.min(...gaps);
            if (gaps.length > 0 && gap >= -TOLERANCE && gap < extent) {
                const described = describeNode(element);
                found.push({selector: described.selector, componentName: described.componentName, clipper: describeNode(node).selector, gap: Math.round(gap * 10) / 10});
                break;
            }
        }
    }
    return found;
}

export function measureStage(stage: HTMLElement): LabStageMeasure {
    const rect = stage.getBoundingClientRect();
    const offenders: LabOverflowOffender[] = [];
    for (const element of stage.querySelectorAll<HTMLElement>("*")) {
        if (offenders.length >= MAX_OFFENDERS) {
            break;
        }
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
            continue;
        }
        const overflow = Math.max(box.right - rect.right, rect.left - box.left);
        if (overflow > TOLERANCE && !invisible(element) && !clipped(element, stage)) {
            const node = describeNode(element);
            offenders.push({selector: node.selector, componentName: node.componentName, overflow: Math.round(overflow)});
        }
    }
    return {
        box: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
        overflowX: Math.max(0, stage.scrollWidth - stage.clientWidth),
        offenders,
        clippedFocus: clippedFocusRings(stage, focusRingExtent(stage)),
    };
}

export function installLabDebugApi(source: Omit<LabDebugApi, "version" | "measure">): () => void {
    window.__nbLab = {
        version: 1,
        ...source,
        measure: () => {
            const stage = document.querySelector<HTMLElement>("[data-lab-stage]");
            return stage === null ? null : measureStage(stage);
        },
    };
    return () => {
        delete window.__nbLab;
    };
}
