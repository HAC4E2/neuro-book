/**
 * 正文图片任务的短生命周期状态总线。
 *
 * 状态不写回 Markdown：它只用于让占位符 NodeView 在编辑器重建、切换
 * 工作区或返回章节后恢复“排队/生成中/完成/失败”提示。任务终态会保留，
 * 直到下一次同一占位符重新提交或页面生命周期结束。
 */
export type TextToImageJobVisualStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export type TextToImageJobState = {
    status: TextToImageJobVisualStatus;
    detail?: string;
};

const states = new Map<string, TextToImageJobState>();
const listeners = new Set<(id: string) => void>();

export function getTextToImageJobState(id: string): TextToImageJobState {
    return states.get(id) ?? {status: "idle"};
}

export function setTextToImageJobState(id: string, state: TextToImageJobState): void {
    if (!id) return;
    states.set(id, state);
    for (const listener of listeners) listener(id);
}

export function subscribeTextToImageJobState(listener: (id: string) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
