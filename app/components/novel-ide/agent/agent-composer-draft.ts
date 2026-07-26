import {parseAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";

const DRAFT_PREFIX = "agent:composer-draft:v1:";
const DRAFT_VERSION = 1;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_DRAFTS = 10;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UTF8_ENCODER = new TextEncoder();

export type AgentComposerDraft = {
    version: 1;
    text: string;
    updatedAt: number;
};

export type AgentComposerDraftLoadResult = {
    text: string;
    discarded?: "corrupt" | "version" | "oversize" | "unsafe" | "expired";
};

export type AgentComposerDraftContext = {
    workspaceKey: string;
    sessionId: number;
    generation: number;
    revision: number;
    text: string;
};

export type AgentComposerSubmission = Readonly<AgentComposerDraftContext>;

export type AgentComposerDraftSaveResult = ReturnType<typeof saveAgentComposerDraft>;

/**
 * 绑定 Workspace/Session 的草稿生命周期。
 *
 * Module 持有旧 context，因此切换时的同步 flush、debounce 和迟到 acceptance 不会读取
 * 调用方已经变化的响应式 workspaceKey/sessionId。
 */
export class AgentComposerDraftSession {
    private context: AgentComposerDraftContext | null = null;
    private generation = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly storage: Storage,
        private readonly onSave?: (result: AgentComposerDraftSaveResult, context: AgentComposerDraftContext) => void,
    ) {}

    /** 原子 flush 旧 context 并加载新 Session 草稿。 */
    switchContext(workspaceKey: string, sessionId: number): AgentComposerDraftLoadResult & {generation: number} {
        this.flush();
        this.cancelTimer();
        this.generation += 1;
        const loaded = loadAgentComposerDraft(this.storage, workspaceKey, sessionId);
        this.context = {
            workspaceKey,
            sessionId,
            generation: this.generation,
            revision: 0,
            text: loaded.text,
        };
        return {...loaded, generation: this.generation};
    }

    /** 关闭当前 context；用于 Project Workspace 切换和组件销毁。 */
    clearContext(): number {
        this.flush();
        this.cancelTimer();
        this.generation += 1;
        this.context = null;
        return this.generation;
    }

    /** 更新当前正文，并捕获 generation 的 300ms 延迟保存。 */
    update(text: string): void {
        if (!this.context || this.context.text === text) {
            return;
        }
        this.context.text = text;
        this.context.revision += 1;
        const generation = this.context.generation;
        this.cancelTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.context?.generation === generation) {
                this.flush();
            }
        }, 300);
    }

    /** 同步保存当前 context；空正文由底层 helper 删除对应 key。 */
    flush(): AgentComposerDraftSaveResult | null {
        if (!this.context) {
            return null;
        }
        const snapshot = {...this.context};
        const result = saveAgentComposerDraft(
            this.storage,
            snapshot.workspaceKey,
            snapshot.sessionId,
            snapshot.text,
        );
        this.onSave?.(result, snapshot);
        return result;
    }

    /** 捕获一次发送对应的不可变 context/revision。 */
    capture(expectedText: string): AgentComposerSubmission | null {
        if (!this.context || this.context.text !== expectedText) {
            return null;
        }
        return Object.freeze({...this.context});
    }

    /**
     * accepted 后 compare-and-clear。
     *
     * 当前 context 已变化时只处理原 key；同一个 key 已进入新 generation 时保持新草稿。
     */
    accept(submission: AgentComposerSubmission): {clearEditor: boolean} {
        const current = this.context;
        if (current
            && current.workspaceKey === submission.workspaceKey
            && current.sessionId === submission.sessionId) {
            if (current.generation !== submission.generation
                || current.revision !== submission.revision
                || current.text !== submission.text) {
                return {clearEditor: false};
            }
            this.cancelTimer();
            current.text = "";
            current.revision += 1;
            clearAgentComposerDraft(this.storage, submission.workspaceKey, submission.sessionId);
            return {clearEditor: true};
        }

        const stored = loadAgentComposerDraft(this.storage, submission.workspaceKey, submission.sessionId);
        if (stored.text === submission.text) {
            clearAgentComposerDraft(this.storage, submission.workspaceKey, submission.sessionId);
        }
        return {clearEditor: false};
    }

    dispose(): void {
        this.clearContext();
    }

    private cancelTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

export function agentComposerDraftKey(workspaceKey: string, sessionId: number): string {
    return `${DRAFT_PREFIX}${workspaceKey}:${String(sessionId)}`;
}

/** 读取并严格校验单个 Session 草稿；坏记录直接删除。 */
export function loadAgentComposerDraft(storage: Storage, workspaceKey: string, sessionId: number, now = Date.now()): AgentComposerDraftLoadResult {
    const key = agentComposerDraftKey(workspaceKey, sessionId);
    const raw = storage.getItem(key);
    if (!raw) {
        return {text: ""};
    }
    try {
        const value = JSON.parse(raw) as Partial<AgentComposerDraft>;
        if (value.version !== DRAFT_VERSION) {
            storage.removeItem(key);
            return {text: "", discarded: "version"};
        }
        if (typeof value.text !== "string" || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) {
            storage.removeItem(key);
            return {text: "", discarded: "corrupt"};
        }
        if (now - value.updatedAt > MAX_DRAFT_AGE_MS) {
            storage.removeItem(key);
            return {text: "", discarded: "expired"};
        }
        if (UTF8_ENCODER.encode(value.text).byteLength > MAX_DRAFT_BYTES) {
            storage.removeItem(key);
            return {text: "", discarded: "oversize"};
        }
        if (hasUnsafeImageTarget(value.text)) {
            storage.removeItem(key);
            return {text: "", discarded: "unsafe"};
        }
        return {text: value.text};
    } catch {
        storage.removeItem(key);
        return {text: "", discarded: "corrupt"};
    }
}

/** 300ms debounce 的调用方最终写入这里；空正文等价于删除草稿。 */
export function saveAgentComposerDraft(storage: Storage, workspaceKey: string, sessionId: number, text: string, now = Date.now()): "saved" | "cleared" | "oversize" | "unsafe" {
    const key = agentComposerDraftKey(workspaceKey, sessionId);
    if (!text) {
        storage.removeItem(key);
        cleanupAgentComposerDrafts(storage, now);
        return "cleared";
    }
    if (UTF8_ENCODER.encode(text).byteLength > MAX_DRAFT_BYTES) {
        storage.removeItem(key);
        cleanupAgentComposerDrafts(storage, now);
        return "oversize";
    }
    if (hasUnsafeImageTarget(text)) {
        storage.removeItem(key);
        cleanupAgentComposerDrafts(storage, now);
        return "unsafe";
    }
    storage.setItem(key, JSON.stringify({version: DRAFT_VERSION, text, updatedAt: now} satisfies AgentComposerDraft));
    cleanupAgentComposerDrafts(storage, now);
    return "saved";
}

export function clearAgentComposerDraft(storage: Storage, workspaceKey: string, sessionId: number): void {
    storage.removeItem(agentComposerDraftKey(workspaceKey, sessionId));
}

/** 清理过期/损坏记录，并只保留最近更新的十个草稿。 */
export function cleanupAgentComposerDrafts(storage: Storage, now = Date.now()): void {
    const drafts: Array<{key: string; updatedAt: number}> = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(DRAFT_PREFIX)) {
            continue;
        }
        const raw = storage.getItem(key);
        try {
            const value = raw ? JSON.parse(raw) as Partial<AgentComposerDraft> : null;
            if (!value
                || value.version !== DRAFT_VERSION
                || typeof value.text !== "string"
                || typeof value.updatedAt !== "number"
                || !Number.isFinite(value.updatedAt)
                || now - value.updatedAt > MAX_DRAFT_AGE_MS
                || UTF8_ENCODER.encode(value.text).byteLength > MAX_DRAFT_BYTES
                || hasUnsafeImageTarget(value.text)) {
                storage.removeItem(key);
                index -= 1;
                continue;
            }
            drafts.push({key, updatedAt: value.updatedAt});
        } catch {
            storage.removeItem(key);
            index -= 1;
        }
    }
    drafts
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(MAX_DRAFTS)
        .forEach((draft) => storage.removeItem(draft.key));
}

function hasUnsafeImageTarget(text: string): boolean {
    return parseAgentImageMarkdown(text).some((part) => part.type === "image"
        && /^(?:data:|blob:)/iu.test(part.target.trim()));
}
