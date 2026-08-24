import {randomUUID} from "node:crypto";
import type {TextToImageRequestType} from "nbook/shared/dto/text-to-image.dto";

export type TextToImageLlmTraceEventKind = "started" | "delta" | "retrying" | "completed" | "failed";

export type TextToImageLlmTraceEvent = {
    traceId: string;
    seq: number;
    kind: TextToImageLlmTraceEventKind;
    requestType: TextToImageRequestType | null;
    profileId: string | null;
    model: string;
    attempt: number;
    at: string;
    delta?: string;
    content?: string;
    error?: string;
    truncated?: boolean;
};

export type TextToImageLlmTraceHandle = {
    traceId: string;
    started(event: Omit<TextToImageLlmTraceEvent, "traceId" | "seq" | "kind" | "at">): void;
    delta(value: string, attempt: number): void;
    retrying(attempt: number, error: string): void;
    completed(content: string, attempt: number): void;
    failed(error: string, attempt: number): void;
};

type TraceRecord = {
    event: TextToImageLlmTraceEvent;
    subscribers: Set<(event: TextToImageLlmTraceEvent) => void>;
    expiresAt: number;
};

const TRACE_TTL_MS = 30 * 60 * 1000;
const TRACE_MAX_DEBUG_CHARS = 512 * 1024;

class TextToImageLlmTraceHub {
    private readonly latest = new Map<number, TraceRecord>();
    private readonly listeners = new Map<number, Set<(event: TextToImageLlmTraceEvent) => void>>();

    start(userId: number, meta: {requestType: TextToImageRequestType | null; profileId?: string | null; model: string}): TextToImageLlmTraceHandle {
        this.prune();
        const traceId = randomUUID();
        const record: TraceRecord = {
            event: {
                traceId,
                seq: 0,
                kind: "started",
                requestType: meta.requestType,
                profileId: meta.profileId ?? null,
                model: meta.model,
                attempt: 0,
                at: new Date().toISOString(),
            },
            subscribers: this.listeners.get(userId) ?? new Set(),
            expiresAt: Date.now() + TRACE_TTL_MS,
        };
        this.latest.set(userId, record);
        this.publish(record);
        let fullContent = "";
        return {
            traceId,
            started: (event) => this.publishEvent(userId, {traceId, ...event, kind: "started"}),
            delta: (value, attempt) => {
                fullContent += value;
                this.publishEvent(userId, {traceId, kind: "delta", delta: value, content: fullContent, attempt});
            },
            retrying: (attempt, error) => {
                fullContent = "";
                this.publishEvent(userId, {traceId, kind: "retrying", attempt, error, content: ""});
            },
            completed: (content, attempt) => {
                fullContent = content;
                this.publishEvent(userId, {traceId, kind: "completed", content, attempt});
            },
            failed: (error, attempt) => this.publishEvent(userId, {traceId, kind: "failed", error, attempt}),
        };
    }

    getLatest(userId: number): TextToImageLlmTraceEvent | null {
        this.prune();
        return this.latest.get(userId)?.event ?? null;
    }

    subscribe(userId: number, listener: (event: TextToImageLlmTraceEvent) => void): () => void {
        this.prune();
        const subscribers = this.listeners.get(userId) ?? new Set<(event: TextToImageLlmTraceEvent) => void>();
        this.listeners.set(userId, subscribers);
        subscribers.add(listener);
        const record = this.latest.get(userId);
        if (record) record.subscribers = subscribers;
        return () => {
            subscribers.delete(listener);
            if (subscribers.size === 0) this.listeners.delete(userId);
        };
    }

    private publishEvent(userId: number, input: Partial<TextToImageLlmTraceEvent> & Pick<TextToImageLlmTraceEvent, "kind">): void {
        const record = this.latest.get(userId);
        if (!record) return;
        if (record.event.traceId !== input.traceId && input.traceId !== undefined) return;
        const nextContent = input.content ?? record.event.content;
        record.event = {
            ...record.event,
            ...input,
            traceId: record.event.traceId,
            seq: record.event.seq + 1,
            at: new Date().toISOString(),
            content: nextContent === undefined ? undefined : truncate(nextContent).value,
            truncated: nextContent === undefined ? record.event.truncated : truncate(nextContent).truncated,
        };
        this.publish(record);
    }

    private publish(record: TraceRecord): void {
        for (const listener of record.subscribers) {
            try {
                listener({...record.event});
            } catch {
                // 调试观察器失败不能影响业务请求。
            }
        }
    }

    private prune(): void {
        const now = Date.now();
        for (const [userId, record] of this.latest) {
            if (record.expiresAt <= now) this.latest.delete(userId);
        }
    }
}

function truncate(value: string): {value: string; truncated: boolean} {
    if (value.length <= TRACE_MAX_DEBUG_CHARS) return {value, truncated: false};
    return {value: value.slice(0, TRACE_MAX_DEBUG_CHARS), truncated: true};
}

export const textToImageLlmTraceHub = new TextToImageLlmTraceHub();
