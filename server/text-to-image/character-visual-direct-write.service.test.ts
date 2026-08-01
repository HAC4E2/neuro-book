import {describe, expect, it, vi} from "vitest";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";
import {CharacterVisualMaterializationError} from "nbook/server/text-to-image/character-visual-materializer";
import {TrackedWorkspaceFileConflictError} from "nbook/server/workspace-history/tracked-workspace-files";
import {
    CharacterVisualDirectWriteError,
    CharacterVisualDirectWriteService,
    type CharacterVisualDirectWriteRuntime,
} from "nbook/server/text-to-image/character-visual-direct-write.service";

const PROJECT_PATH = "workspace/demo";
const CHARACTER_PATH = "lorebook/character/hero/index.md";
const SOURCE = "# Hero\n\nA calm young traveler.\n";
const HASH = createTextToImageFileHash(SOURCE);
const KEY = "9aa9105b-0c1c-4ad3-9032-20b2aafc7e5f";

function request(overrides: Partial<{projectPath: string; characterPath: string; sourceCharacterFileHash: string; idempotencyKey: string}> = {}) {
    return {
        projectPath: PROJECT_PATH,
        characterPath: CHARACTER_PATH,
        sourceCharacterFileHash: HASH,
        idempotencyKey: KEY,
        ...overrides,
    };
}

function output() {
    return {
        schemaVersion: "nbook.character-visual-director-output/v2" as const,
        operation: "generate-character-visual" as const,
        state: "completed" as const,
        sourceCharacterFileHash: HASH,
        summary: "角色视觉资料已生成。",
        character: {
            names: {cn: "旅行者", en: "Traveler"},
            fields: {
                profileTraits: "calm",
                facialAppearance: "brown eyes",
                facialBack: "short hair",
                upperSfw: "coat",
                upperBackSfw: "coat",
                lowerSfw: "boots",
                lowerBackSfw: "boots",
                upperNsfw: "",
                upperBackNsfw: "",
                lowerNsfw: "",
                lowerBackNsfw: "",
                negativePrompt: "",
            },
        },
        outfits: [{
            names: {cn: "棕发青年旅行便装", en: "Brown-haired young traveler casual wear"},
            fields: {upper: "brown coat", upperBack: "brown coat", lower: "black boots", lowerBack: "black boots"},
        }],
        diagnostics: [],
    };
}

class MemoryRuntime implements CharacterVisualDirectWriteRuntime {
    readonly files = new Map<string, string>();
    readonly writes: string[] = [];
    readonly acquire = vi.fn(async () => ({sessionId: 41}));
    readonly start = vi.fn(async (input: {onAccepted(input: {sessionId: number; invocationId: string; clientMessageId: string}): Promise<void>}) => {
        await input.onAccepted({sessionId: 41, invocationId: "invoke-41", clientMessageId: this.clientMessageId});
    });
    readonly resolve = vi.fn(async () => this.start.mock.calls.length === 0
        ? {state: "missing" as const}
        : {state: "completed" as const, invocationId: "invoke-41", reportResult: output()});
    readonly materialize = vi.fn(async () => ({
        characterMarkdown: "character-target\n",
        outfits: [{path: "lorebook/character/hero/outfits/棕发青年旅行便装.md", content: "outfit-target\n"}],
        diagnostics: [],
    }));
    clientMessageId = "";
    nowMs = 0;

    constructor() {
        this.files.set(CHARACTER_PATH, SOURCE);
    }

    async read(filePath: string): Promise<string | null> {
        return this.files.get(filePath) ?? null;
    }

    async write(input: {path: string; content: string; knownBefore: string | null}): Promise<void> {
        expect(this.files.get(input.path) ?? null).toBe(input.knownBefore);
        this.files.set(input.path, input.content);
        this.writes.push(input.path);
    }

    async snapshot() {
        return {
            root: "/projects/demo",
            characterId: "hero",
            characterPath: CHARACTER_PATH,
            sourceMarkdown: await this.read(CHARACTER_PATH),
            characterImageTags: await this.read("lorebook/character/hero/image-tags.md"),
            referencedOutfits: [],
        };
    }

    async sleep(ms: number): Promise<void> {
        this.nowMs += ms;
    }

    now(): number {
        return this.nowMs;
    }

    invalidate = vi.fn();
}

function service(runtime: MemoryRuntime, options: Partial<{waitBudgetMs: number; pollIntervalMs: number}> = {}) {
    return new CharacterVisualDirectWriteService(runtime, {
        waitBudgetMs: 30,
        pollIntervalMs: 5,
        ...options,
    });
}

describe("character visual direct-write service", () => {
    it("creates the immutable journal before Director admission", async () => {
        const runtime = new MemoryRuntime();
        runtime.start.mockImplementationOnce(async (input) => {
            expect([...runtime.files.keys()]).toContain(`.nbook/text-to-image/character-visual-direct-write/${KEY}/journal.json`);
            await input.onAccepted({sessionId: 41, invocationId: "invoke-41", clientMessageId: runtime.clientMessageId});
        });

        await service(runtime).generate(request());

        expect(runtime.start).toHaveBeenCalledTimes(1);
    });

    it("reacquires a tagged Session after a crash before Session writeback", async () => {
        const runtime = new MemoryRuntime();
        let failOnce = true;
        const write = runtime.write.bind(runtime);
        runtime.write = vi.fn(async (input) => {
            if (failOnce && input.path.endsWith("journal.json") && input.content.includes("\"sessionId\": 41")) {
                failOnce = false;
                throw new Error("simulated crash before Session writeback");
            }
            await write(input);
        });

        await expect(service(runtime).generate(request())).rejects.toThrow("simulated crash");
        await service(runtime).generate(request());

        expect(runtime.acquire).toHaveBeenCalledTimes(2);
        expect(runtime.start).toHaveBeenCalledTimes(1);
    });

    it("persists durable admission before the runtime may start its Provider", async () => {
        const runtime = new MemoryRuntime();
        runtime.start.mockImplementationOnce(async (input) => {
            await input.onAccepted({sessionId: 41, invocationId: "invoke-41", clientMessageId: runtime.clientMessageId});
            expect(await runtime.read(`.nbook/text-to-image/character-visual-direct-write/${KEY}/journal.json`)).toContain("invoke-41");
        });

        await service(runtime).generate(request());
    });

    it("uses durable admission after response loss instead of invoking a second time", async () => {
        const runtime = new MemoryRuntime();
        runtime.resolve
            .mockResolvedValueOnce({state: "missing"})
            .mockResolvedValueOnce({state: "active", invocationId: "invoke-41", lifecycle: "running", executionLeaseUntil: new Date(1000).toISOString()});
        runtime.start.mockImplementationOnce(async (input) => {
            await input.onAccepted({sessionId: 41, invocationId: "invoke-41", clientMessageId: runtime.clientMessageId});
            throw new Error("response lost");
        });

        await service(runtime).generate(request());

        expect(runtime.start).toHaveBeenCalledTimes(1);
    });

    it("shares the same character mutation lock across service instances and admits once", async () => {
        const runtime = new MemoryRuntime();
        const [first, second] = await Promise.all([
            service(runtime).generate(request()),
            service(runtime).generate(request()),
        ]);

        expect(first).toEqual(second);
        expect(runtime.start).toHaveBeenCalledTimes(1);
    });

    it("serializes different keys for one character and makes the later frozen target stale", async () => {
        const runtime = new MemoryRuntime();
        const secondKey = "7136d1d2-12c3-496e-a1af-352812fc932d";
        const admitted = new Set<string>();
        let completed = false;
        runtime.start.mockImplementation(async (input) => {
            admitted.add(input.clientMessageId);
            await input.onAccepted({sessionId: 41, invocationId: `invoke-${input.clientMessageId}`, clientMessageId: input.clientMessageId});
        });
        runtime.resolve.mockImplementation(async (input) => {
            if (!admitted.has(input.clientMessageId)) return {state: "missing" as const};
            if (!completed) return {state: "active" as const, invocationId: `invoke-${input.clientMessageId}`, lifecycle: "running", executionLeaseUntil: new Date(1_000).toISOString()};
            return {state: "completed" as const, invocationId: `invoke-${input.clientMessageId}`, reportResult: output()};
        });

        await expect(service(runtime, {waitBudgetMs: 0}).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_RUNNING"});
        await expect(service(runtime, {waitBudgetMs: 0}).generate(request({idempotencyKey: secondKey}))).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_RUNNING"});
        completed = true;

        const [first, second] = await Promise.allSettled([
            service(runtime).generate(request()),
            service(runtime).generate(request({idempotencyKey: secondKey})),
        ]);
        expect(first.status).toBe("fulfilled");
        expect(second).toMatchObject({status: "rejected", reason: {code: "CHARACTER_VISUAL_TARGET_STALE"}});
    });

    it("seals an onAccepted persistence failure and never re-invokes the client message", async () => {
        const runtime = new MemoryRuntime();
        const write = runtime.write.bind(runtime);
        runtime.write = vi.fn(async (input) => {
            if (input.path.endsWith("journal.json") && input.content.includes("invoke-41")) {
                throw new Error("journal unavailable");
            }
            await write(input);
        });
        runtime.resolve.mockImplementation(async () => runtime.start.mock.calls.length === 0
            ? {state: "missing" as const}
            : {state: "failed" as const, invocationId: "invoke-41", errorInfo: null});

        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_DIRECTOR_FAILED"});
        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_DIRECTOR_FAILED"});
        expect(runtime.start).toHaveBeenCalledTimes(1);
    });

    it("bounded-waits active work, returns completion, and keeps a live budget expiry retryable", async () => {
        const runtime = new MemoryRuntime();
        runtime.resolve
            .mockResolvedValueOnce({state: "active", invocationId: "invoke-41", lifecycle: "running", executionLeaseUntil: new Date(1000).toISOString()})
            .mockResolvedValueOnce({state: "completed", invocationId: "invoke-41", reportResult: output()});
        await service(runtime).generate(request());

        const live = new MemoryRuntime();
        live.resolve.mockResolvedValue({state: "active", invocationId: "invoke-41", lifecycle: "running", executionLeaseUntil: new Date(1000).toISOString()});
        await expect(service(live).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_RUNNING"});
        expect(live.start).not.toHaveBeenCalled();
        expect(await live.read(`.nbook/text-to-image/character-visual-direct-write/${KEY}/journal.json`)).not.toContain("\"state\":\"failed\"");
    });

    it("re-reads active durable state and maps lease expiry to an orphaned terminal failure", async () => {
        const runtime = new MemoryRuntime();
        runtime.resolve
            .mockResolvedValueOnce({state: "active", invocationId: "invoke-41", lifecycle: "running", executionLeaseUntil: new Date(5).toISOString()})
            .mockResolvedValueOnce({state: "orphaned", invocationId: "invoke-41", lifecycle: "running", providerStartRecorded: true});

        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_INVOCATION_ORPHANED"});
    });

    it("persists exact durable terminal errors after a legal admission and replays them without invoking again", async () => {
        for (const [durable, code] of [
            [{state: "missing"} as const, "CHARACTER_VISUAL_DURABLE_INVOCATION_MISSING"],
            [{state: "orphaned", invocationId: "invoke-41", lifecycle: "running", providerStartRecorded: true} as const, "CHARACTER_VISUAL_INVOCATION_ORPHANED"],
            [{state: "waiting", invocationId: "invoke-41"} as const, "CHARACTER_VISUAL_DIRECTOR_FAILED"],
            [{state: "failed", invocationId: "invoke-41", errorInfo: {message: "provider failed"}} as const, "CHARACTER_VISUAL_DIRECTOR_FAILED"],
            [{state: "completed_without_result", invocationId: "invoke-41"} as const, "CHARACTER_VISUAL_DIRECTOR_FAILED"],
        ] as const) {
            const runtime = new MemoryRuntime();
            runtime.resolve
                .mockResolvedValueOnce({state: "missing"})
                .mockResolvedValue({state: "active", invocationId: "invoke-41", lifecycle: "running", executionLeaseUntil: new Date(1_000).toISOString()});
            await expect(service(runtime, {waitBudgetMs: 0}).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_RUNNING"});
            expect(runtime.start).toHaveBeenCalledTimes(1);

            runtime.resolve.mockReset();
            runtime.resolve.mockResolvedValue(durable);
            await expect(service(runtime).generate(request())).rejects.toMatchObject({code});
            await expect(service(runtime).generate(request())).rejects.toMatchObject({code});
            expect(runtime.start).toHaveBeenCalledTimes(1);
        }
    });

    it("returns the exact completed result on replay and conflicts on a changed identity", async () => {
        const runtime = new MemoryRuntime();
        const first = await service(runtime).generate(request());
        const second = await service(runtime).generate(request());
        expect(second).toEqual(first);
        await expect(service(runtime).generate(request({sourceCharacterFileHash: `sha256:${"0".repeat(64)}`}))).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_CONFLICT"});
        await expect(service(runtime).generate(request({projectPath: "workspace/other"}))).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_CONFLICT"});
        await expect(service(runtime).generate(request({characterPath: "lorebook/character/other/index.md"}))).rejects.toMatchObject({code: "CHARACTER_VISUAL_OPERATION_CONFLICT"});
    });

    it("freezes actor and strict output/result hashes, then fails closed on journal tampering", async () => {
        const runtime = new MemoryRuntime();
        await service(runtime).generate(request());
        const journalPath = `.nbook/text-to-image/character-visual-direct-write/${KEY}/journal.json`;
        const journal = JSON.parse((await runtime.read(journalPath))!);
        expect(journal.actor).toBe("user-local");
        expect(journal.directorOutputHash).toMatch(/^sha256:/u);
        expect(journal.resultHash).toMatch(/^sha256:/u);

        runtime.files.set(journalPath, JSON.stringify({...journal, resultHash: `sha256:${"0".repeat(64)}`}));
        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_DIRECTOR_FAILED"});
    });

    it("fails closed before I/O when immutable journal identity or target routes are tampered", async () => {
        const journalPath = `.nbook/text-to-image/character-visual-direct-write/${KEY}/journal.json`;
        const mutations: Array<(journal: {sourceCharacterMarkdown: string; characterId: string; targets: Array<{path: string}>}) => void> = [
            (journal) => { journal.sourceCharacterMarkdown = "# Tampered\n"; },
            (journal) => { journal.characterId = "other"; },
            (journal) => { journal.targets[0]!.path = "lorebook/character/hero/outfits/redirect.md"; },
            (journal) => { journal.targets[1]!.path = "lorebook/character/other/outfits/redirect.md"; },
        ];
        for (const mutate of mutations) {
            const runtime = new MemoryRuntime();
            await service(runtime).generate(request());
            const journal = JSON.parse((await runtime.read(journalPath))!);
            mutate(journal);
            runtime.files.set(journalPath, JSON.stringify(journal));
            runtime.writes.length = 0;
            runtime.acquire.mockClear();
            runtime.start.mockClear();

            await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_DIRECTOR_FAILED"});
            expect(runtime.acquire).not.toHaveBeenCalled();
            expect(runtime.start).not.toHaveBeenCalled();
            expect(runtime.writes).toEqual([]);
        }
    });

    it("marks source or target drift stale before prepare", async () => {
        const sourceChanged = new MemoryRuntime();
        sourceChanged.resolve.mockImplementation(async () => {
            sourceChanged.files.set(CHARACTER_PATH, "# Changed\n");
            return {state: "completed", invocationId: "invoke-41", reportResult: output()};
        });
        await expect(service(sourceChanged).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_SOURCE_STALE"});

        const targetChanged = new MemoryRuntime();
        targetChanged.materialize.mockImplementationOnce(async () => {
            targetChanged.files.set("lorebook/character/hero/image-tags.md", "external change\n");
            return {characterMarkdown: "character-target\n", outfits: [], diagnostics: []};
        });
        await expect(service(targetChanged).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_TARGET_STALE"});
    });

    it("writes sorted outfits before image-tags and resumes an already-written outfit", async () => {
        const runtime = new MemoryRuntime();
        runtime.materialize.mockResolvedValueOnce({
            characterMarkdown: "character-target\n",
            outfits: [
                {path: "lorebook/character/hero/outfits/z.md", content: "z\n"},
                {path: "lorebook/character/hero/outfits/a.md", content: "a\n"},
            ],
            diagnostics: [],
        });
        runtime.resolve.mockResolvedValue({
            state: "completed",
            invocationId: "invoke-41",
            reportResult: {...output(), outfits: [
                {names: {cn: "a", en: "a"}, fields: {upper: "coat", upperBack: "coat", lower: "boots", lowerBack: "boots"}},
                {names: {cn: "z", en: "z"}, fields: {upper: "coat", upperBack: "coat", lower: "boots", lowerBack: "boots"}},
            ]},
        });
        await service(runtime).generate(request());
        expect(runtime.writes.filter((path) => path.includes("outfits/"))).toEqual([
            "lorebook/character/hero/outfits/a.md",
            "lorebook/character/hero/outfits/z.md",
        ]);
        const targetWrites = runtime.writes.filter((path) => !path.endsWith("journal.json"));
        expect(targetWrites.at(-1)).toBe("lorebook/character/hero/image-tags.md");
    });

    it("recovers after an outfit write, but marks third-party replacement bytes stale", async () => {
        const runtime = new MemoryRuntime();
        let failCharacterOnce = true;
        const write = runtime.write.bind(runtime);
        runtime.write = vi.fn(async (input) => {
            if (failCharacterOnce && input.path.endsWith("/image-tags.md")) {
                failCharacterOnce = false;
                throw new Error("crash before image-tags");
            }
            await write(input);
        });
        await expect(service(runtime).generate(request())).rejects.toThrow("crash before image-tags");
        expect(await runtime.read("lorebook/character/hero/outfits/棕发青年旅行便装.md")).toBe("outfit-target\n");
        await service(runtime).generate(request());
        expect(runtime.writes.filter((path) => path === "lorebook/character/hero/outfits/棕发青年旅行便装.md")).toHaveLength(1);

        const stale = new MemoryRuntime();
        let failAgain = true;
        const staleWrite = stale.write.bind(stale);
        stale.write = vi.fn(async (input) => {
            if (failAgain && input.path.endsWith("/image-tags.md")) {
                failAgain = false;
                throw new Error("crash before image-tags");
            }
            await staleWrite(input);
        });
        await expect(service(stale).generate(request())).rejects.toThrow("crash before image-tags");
        stale.files.set("lorebook/character/hero/outfits/棕发青年旅行便装.md", "external replacement\n");
        await expect(service(stale).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_TARGET_STALE"});
    });

    it("does not rewrite a valid outfit omitted by the completed Director output", async () => {
        const runtime = new MemoryRuntime();
        runtime.files.set("lorebook/character/hero/outfits/old.md", "old outfit\n");
        runtime.snapshot = vi.fn(async () => ({
            root: "/projects/demo",
            characterId: "hero",
            characterPath: CHARACTER_PATH,
            sourceMarkdown: SOURCE,
            characterImageTags: null,
            referencedOutfits: [{path: "lorebook/character/hero/outfits/old.md", content: "old outfit\n"}],
        }));
        runtime.materialize.mockResolvedValueOnce({
            characterMarkdown: "character referencing old and new\n",
            outfits: [
                {path: "lorebook/character/hero/outfits/old.md", content: "rewritten old\n"},
                {path: "lorebook/character/hero/outfits/棕发青年旅行便装.md", content: "outfit-target\n"},
            ],
            diagnostics: [],
        });
        await service(runtime).generate(request());
        expect(await runtime.read("lorebook/character/hero/outfits/old.md")).toBe("old outfit\n");
    });

    it("rejects deleted or replaced referenced outfits even when Director did not return them", async () => {
        for (const replacement of [null, "third-party replacement\n"]) {
            const runtime = new MemoryRuntime();
            runtime.files.set("lorebook/character/hero/outfits/old.md", "old outfit\n");
            runtime.snapshot = vi.fn(async () => ({
                root: "/projects/demo",
                characterId: "hero",
                characterPath: CHARACTER_PATH,
                sourceMarkdown: SOURCE,
                characterImageTags: null,
                referencedOutfits: [{
                    path: "lorebook/character/hero/outfits/old.md",
                    content: "old outfit\n",
                }],
            }));
            runtime.materialize.mockImplementationOnce(async () => {
                runtime.files.set("lorebook/character/hero/outfits/old.md", replacement ?? "");
                if (replacement === null) runtime.files.delete("lorebook/character/hero/outfits/old.md");
                return {characterMarkdown: "character-target\n", outfits: [], diagnostics: []};
            });

            await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_TARGET_STALE"});
            expect(runtime.writes).not.toContain("lorebook/character/hero/image-tags.md");
        }
    });

    it("orders non-ASCII outfit paths by code point before image-tags", async () => {
        const runtime = new MemoryRuntime();
        runtime.resolve.mockResolvedValue({
            state: "completed",
            invocationId: "invoke-41",
            reportResult: {...output(), outfits: [
                {names: {cn: "ä", en: "a-diaeresis"}, fields: {upper: "coat", upperBack: "coat", lower: "boots", lowerBack: "boots"}},
                {names: {cn: "z", en: "z"}, fields: {upper: "coat", upperBack: "coat", lower: "boots", lowerBack: "boots"}},
            ]},
        });
        runtime.materialize.mockResolvedValueOnce({
            characterMarkdown: "character-target\n",
            outfits: [
                {path: "lorebook/character/hero/outfits/ä.md", content: "ä\n"},
                {path: "lorebook/character/hero/outfits/z.md", content: "z\n"},
            ],
            diagnostics: [],
        });

        await service(runtime).generate(request());
        expect(runtime.writes.filter((path) => path.includes("outfits/"))).toEqual([
            "lorebook/character/hero/outfits/z.md",
            "lorebook/character/hero/outfits/ä.md",
        ]);
    });

    it("maps a materializer policy rejection to the shared terminal error before any target write", async () => {
        const runtime = new MemoryRuntime();
        runtime.materialize.mockRejectedValueOnce(new CharacterVisualMaterializationError("CHARACTER_VISUAL_POLICY_BLOCKED", "review required"));
        await expect(service(runtime).generate(request())).rejects.toBeInstanceOf(CharacterVisualDirectWriteError);
        expect(await runtime.read("lorebook/character/hero/image-tags.md")).toBeNull();
    });

    it("persists a tracked CAS conflict as target stale for replay", async () => {
        const runtime = new MemoryRuntime();
        const write = runtime.write.bind(runtime);
        runtime.write = vi.fn(async (input) => {
            if (input.path.endsWith("/image-tags.md")) {
                throw new TrackedWorkspaceFileConflictError(input.path);
            }
            await write(input);
        });

        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_TARGET_STALE"});
        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_TARGET_STALE"});
    });

    it("keeps blocked output all-or-nothing and preserves valid unreturned outfits", async () => {
        const runtime = new MemoryRuntime();
        runtime.files.set("lorebook/character/hero/outfits/old.md", "old outfit\n");
        runtime.resolve.mockResolvedValue({
            state: "completed",
            invocationId: "invoke-41",
            reportResult: {...output(), state: "blocked", character: null, outfits: []},
        });
        await expect(service(runtime).generate(request())).rejects.toMatchObject({code: "CHARACTER_VISUAL_POLICY_BLOCKED"});
        expect(await runtime.read("lorebook/character/hero/outfits/old.md")).toBe("old outfit\n");
        expect(runtime.materialize).not.toHaveBeenCalled();
    });
});
