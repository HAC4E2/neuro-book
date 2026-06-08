import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    createProjectRagEvent,
    createProjectRagMemory,
    deleteProjectRagEvent,
    readProjectRagOverview,
    readProjectRagSubject,
    rebuildProjectSubjectRag,
    reorderProjectRagEvent,
    searchProjectSubjectRag,
    updateProjectRagMemory,
} from "nbook/server/rag/project-rag-visualization";
import {parseSubjectEventsJsonl, parseSubjectMemoriesJsonl} from "nbook/server/agent/tools/subject-memory";

describe("project RAG visualization service", () => {
    let root: string;
    let originalCwd: string;
    let originalFetch: typeof fetch;
    const projectPath = "workspace/rag-visual-test";

    beforeEach(async () => {
        originalCwd = process.cwd();
        originalFetch = globalThis.fetch;
        root = await mkdtemp(join(tmpdir(), "nbook-project-rag-visual-test-"));
        process.chdir(root);
        await mkdir(join(root, "assets", "workspace", ".nbook"), {recursive: true});
        await mkdir(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", "project.yaml"), "kind: novel\ntitle: RAG Test\nsummary: ''\n", "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), [
            "{\"time\":\"早晨\",\"text\":\"我被艾琳娜帮助，没有迟到。\"}",
            "{\"time\":\"午休\",\"text\":\"我还不确定艾琳娜是否就是粉色头发女孩。\"}",
            "",
        ].join("\n"), "utf-8");
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "memory.jsonl"), [
            "{\"topic\":\"艾琳娜\",\"aliases\":[\"粉色头发女孩\"],\"view\":\"她帮过我，我对她有感谢。\"}",
            "",
        ].join("\n"), "utf-8");
    });

    afterEach(async () => {
        globalThis.fetch = originalFetch;
        process.chdir(originalCwd);
        await rm(root, {recursive: true, force: true});
    });

    it("读取 Project 级 subject RAG 概览和详情", async () => {
        const overview = await readProjectRagOverview(projectPath);
        expect(overview.subjects).toHaveLength(1);
        expect(overview.subjects[0]).toMatchObject({
            subjectPath: "simulation/subjects/heroine",
            eventCount: 2,
            memoryCount: 1,
        });

        const detail = await readProjectRagSubject(projectPath, "simulation/subjects/heroine");
        expect(detail.events[0]).toMatchObject({line: 1, time: "早晨"});
        expect(detail.memories[0]).toMatchObject({line: 1, topic: "艾琳娜"});
    });

    it("无 subjects 时返回空概览", async () => {
        await mkdir(join(root, "workspace", "empty-rag-project"), {recursive: true});
        await writeFile(join(root, "workspace", "empty-rag-project", "project.yaml"), "kind: novel\ntitle: Empty RAG\nsummary: ''\n", "utf-8");

        const overview = await readProjectRagOverview("workspace/empty-rag-project");

        expect(overview.subjects).toEqual([]);
    });

    it("events CRUD 会写回 JSONL 并标记 dirty", async () => {
        await createProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            event: {time: "放学", text: "我向艾琳娜道谢。"},
        });
        await reorderProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            fromIndex: 2,
            toIndex: 0,
        });
        await deleteProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            index: 1,
        });

        const eventsText = await readFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), "utf-8");
        expect(parseSubjectEventsJsonl(eventsText).map((event) => event.text)).toEqual([
            "我向艾琳娜道谢。",
            "我还不确定艾琳娜是否就是粉色头发女孩。",
        ]);
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"events\"");
    });

    it("memory CRUD 使用 topic 定位并标记 dirty", async () => {
        await createProjectRagMemory(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            memory: {topic: "王都学院", view: "这是我上学的地方。"},
        });
        await updateProjectRagMemory(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            topic: "王都学院",
            memory: {topic: "王都学院", aliases: ["学院"], view: "这是我学习和生活的地方。"},
        });

        const memoriesText = await readFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "memory.jsonl"), "utf-8");
        expect(parseSubjectMemoriesJsonl(memoriesText).find((memory) => memory.topic === "王都学院")).toMatchObject({
            aliases: ["学院"],
            view: "这是我学习和生活的地方。",
        });
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag-dirty.json"), "utf-8")).resolves.toContain("\"memory\"");
    });

    it("坏 JSONL 禁止 CRUD 覆盖", async () => {
        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), "{\"text\":\"ok\"}\n{bad}\n", "utf-8");

        await expect(createProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            event: {text: "不应写入。"},
        })).rejects.toThrow("events.jsonl 无效");
    });

    it("CRUD 不会创建不存在的 subject", async () => {
        await expect(createProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/new-subject",
            event: {text: "不应创建新 subject。"},
        })).rejects.toThrow("subject 不存在");
    });

    it("embedding 未配置时重建索引返回 subject 级错误", async () => {
        const result = await rebuildProjectSubjectRag(projectPath, {
            subjectPath: "simulation/subjects/heroine",
        });

        expect(result).toMatchObject({
            rebuiltSubjects: 0,
            skippedSubjects: 1,
            results: [{
                subjectPath: "simulation/subjects/heroine",
                ok: false,
            }],
        });
        expect(result.results[0]?.message).toContain("embedding");
    });

    it("搜索使用真实 subject RAG 链路并消费 dirty", async () => {
        await mkdir(join(root, "workspace", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", ".nbook", "config.json"), JSON.stringify({
            embedding: {
                enabled: true,
                provider: "openai-compatible",
                model: "test-embed",
                dimensions: 1536,
                apiKey: "sk-test",
                baseURL: "https://embedding.test/v1",
            },
        }), "utf-8");
        await mkdir(join(root, "workspace", "rag-visual-test", ".nbook"), {recursive: true});
        await writeFile(join(root, "workspace", "rag-visual-test", ".nbook", "config.json"), JSON.stringify({
            embedding: {
                model: "project-embed",
                dimensions: 3,
            },
        }), "utf-8");
        globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body ?? "{}")) as {input?: string[]};
            const input = Array.isArray(body.input) ? body.input : [];
            return new Response(JSON.stringify({
                data: input.map((text) => ({
                    embedding: text.includes("艾琳娜") ? [1, 0, 0] : [0, 1, 0],
                })),
            }), {
                status: 200,
                headers: {"Content-Type": "application/json"},
            });
        }) as typeof fetch;

        await createProjectRagEvent(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            event: {text: "艾琳娜后来成为我信任的人。"},
        });
        const result = await searchProjectSubjectRag(projectPath, {
            subjectPath: "simulation/subjects/heroine",
            query: "艾琳娜 信任",
            sources: ["events"],
            limit: 3,
        });

        expect(result.candidates.some((candidate) => candidate.text.includes("信任"))).toBe(true);
        await expect(readFile(join(root, "workspace", "rag-visual-test", ".nbook", "subject-rag.sqlite"))).resolves.toBeInstanceOf(Buffer);

        await writeFile(join(root, "workspace", "rag-visual-test", "simulation", "subjects", "heroine", "events.jsonl"), [
            "{\"time\":\"早晨\",\"text\":\"我被艾琳娜帮助，没有迟到。\"}",
            "{\"time\":\"午休\",\"text\":\"我还不确定艾琳娜是否就是粉色头发女孩。\"}",
            "{\"text\":\"我直接通过文件编辑器追加了新经历。\"}",
            "",
        ].join("\n"), "utf-8");
        const detail = await readProjectRagSubject(projectPath, "simulation/subjects/heroine");
        expect(detail.sourceStatuses.find((status) => status.source === "events")?.status).toBe("dirty");
    });
});
