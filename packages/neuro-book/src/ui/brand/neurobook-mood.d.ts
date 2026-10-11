/** `neurobook-mood.js` 是品牌成品导出的原生自定义元素（见同目录 README）；引入它只为登记元素，没有导出。 */

export type NeuroBookMoodState = "focus" | "think" | "write" | "done" | "ask" | "error" | "idle" | "sleep" | "idea" | "shy" | "shy_more";

export interface NeuroBookMoodElement extends HTMLElement {
    state: NeuroBookMoodState;
    variant: "tile" | "dark";
    paused: boolean;
}
