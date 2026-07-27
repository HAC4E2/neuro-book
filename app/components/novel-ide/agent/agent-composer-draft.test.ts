import {describe, expect, it} from "vitest";
import {
    AgentComposerDraftSession,
    agentComposerDraftKey,
    loadAgentComposerDraft,
    saveAgentComposerDraft,
} from "nbook/app/components/novel-ide/agent/agent-composer-draft";

describe("Agent Composer 草稿", () => {
    it("按 workspaceKey 与 sessionId 隔离保存和读取", () => {
        const storage = new MemoryStorage();

        expect(saveAgentComposerDraft(storage, "novel:a", 12, "正文", 100)).toBe("saved");
        expect(loadAgentComposerDraft(storage, "novel:a", 12, 101)).toEqual({text: "正文"});
        expect(loadAgentComposerDraft(storage, "novel:a", 13, 101)).toEqual({text: ""});
        expect(storage.getItem(agentComposerDraftKey("novel:a", 12))).toContain('"version":1');
    });

    it("拒绝 Blob/data 图片与超过 256 KiB 的正文", () => {
        const storage = new MemoryStorage();

        expect(saveAgentComposerDraft(storage, "novel:a", 1, "![图](data:image/png;base64,AAAA)")).toBe("unsafe");
        expect(saveAgentComposerDraft(storage, "novel:a", 2, "![图](blob:http://localhost/id)")).toBe("unsafe");
        expect(saveAgentComposerDraft(storage, "novel:a", 3, "x".repeat(256 * 1024 + 1))).toBe("oversize");
        expect(storage.length).toBe(0);
    });

    it("最多保留十条，并清理三十天前的记录", () => {
        const storage = new MemoryStorage();
        for (let sessionId = 1; sessionId <= 11; sessionId += 1) {
            saveAgentComposerDraft(storage, "novel:a", sessionId, `draft-${String(sessionId)}`, sessionId);
        }

        expect(storage.length).toBe(10);
        expect(storage.getItem(agentComposerDraftKey("novel:a", 1))).toBeNull();
        expect(loadAgentComposerDraft(storage, "novel:a", 2, 31 * 24 * 60 * 60 * 1000)).toEqual({
            text: "",
            discarded: "expired",
        });
    });

    it("切换 context 时把最后修改同步写回旧 Workspace/Session key", () => {
        const storage = new MemoryStorage();
        const drafts = new AgentComposerDraftSession(storage);

        drafts.switchContext("novel:a", 1);
        drafts.update("旧项目最后修改");
        drafts.switchContext("novel:b", 1);

        expect(loadAgentComposerDraft(storage, "novel:a", 1)).toEqual({text: "旧项目最后修改"});
        expect(loadAgentComposerDraft(storage, "novel:b", 1)).toEqual({text: ""});
        drafts.dispose();
    });

    it("acceptance 只清除提交 revision，不删除请求期间的新正文", () => {
        const storage = new MemoryStorage();
        const drafts = new AgentComposerDraftSession(storage);
        drafts.switchContext("novel:a", 1);
        drafts.update("已提交正文");
        const submission = drafts.capture("已提交正文");
        expect(submission).not.toBeNull();

        drafts.update("请求期间的新正文");
        expect(drafts.accept(submission!)).toEqual({clearEditor: false});
        drafts.flush();
        expect(loadAgentComposerDraft(storage, "novel:a", 1)).toEqual({text: "请求期间的新正文"});
        drafts.dispose();
    });

    it("迟到 acceptance 只清理原 context，不影响当前 Session 草稿", () => {
        const storage = new MemoryStorage();
        const drafts = new AgentComposerDraftSession(storage);
        drafts.switchContext("novel:a", 1);
        drafts.update("已提交正文");
        const submission = drafts.capture("已提交正文")!;
        drafts.switchContext("novel:a", 2);
        drafts.update("另一个 Session 草稿");

        expect(drafts.accept(submission)).toEqual({clearEditor: false});
        expect(loadAgentComposerDraft(storage, "novel:a", 1)).toEqual({text: ""});
        drafts.flush();
        expect(loadAgentComposerDraft(storage, "novel:a", 2)).toEqual({text: "另一个 Session 草稿"});
        drafts.dispose();
    });
});

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}
