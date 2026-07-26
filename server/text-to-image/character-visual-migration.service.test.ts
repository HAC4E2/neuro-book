import {describe, expect, it} from "vitest";
import {parseCharacterImageTagsMarkdown, parseOutfitTagsMarkdown} from "nbook/server/text-to-image/character-visual.codec";
import {createTextToImageMarkdownFileHash} from "nbook/server/text-to-image/strict-frontmatter";
import {absoluteFsPath} from "nbook/server/text-to-image/compat";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ProjectPath} from "nbook/server/workspace-files/project-path";
import {
    CharacterVisualMigrationError,
    CharacterVisualMigrationService,
    type CharacterVisualMigrationFileStore,
    type CharacterVisualMigrationResolver,
} from "nbook/server/text-to-image/character-visual-migration.service";

function characterMarkdown() {
    return [
        "# image-tags", "", "## 角色中文名称", "主角|少年", "", "## 角色英文名称", "hero", "",
        "## 角色特征", "calm, ((blue eyes))", "", "## 五官外貌", "sharp eyes", "",
        "## 负面提示词", "bad anatomy", "", "## 服装列表", "- [旅行装/travel outfit](outfits/travel.md)", "",
    ].join("\n");
}

function outfitMarkdown() {
    return [
        "# 旅行装/travel outfit", "", "## 归属角色", "hero", "", "## 上半身", "coat, scarf", "",
        "## 上半身背面", "coat back", "", "## 下半身", "trousers", "", "## 下半身背面", "trousers back", "",
    ].join("\n");
}

function ttpCharacterSource(profileTraits = "brave") {
    return `${JSON.stringify({
        characters: {
            hero_source: {
                nameCN: "主角",
                nameEN: "hero",
                characterTraits: profileTraits,
                facialFeatures: "sharp eyes",
                facialFeaturesBack: "",
                upperBodySFW: "white shirt",
                upperBodySFWBack: "",
                fullBodySFW: "black trousers",
                fullBodySFWBack: "",
                upperBodyNSFW: "",
                upperBodyNSFWBack: "",
                fullBodyNSFW: "",
                fullBodyNSFWBack: "",
                outfits: ["ceremony"],
            },
        },
        outfits: {
            ceremony: {
                nameCN: "礼服",
                nameEN: "ceremony",
                owner: "hero_source",
                upperBody: "formal coat",
                upperBodyBack: "coat back",
                fullBody: "formal trousers",
                fullBodyBack: "trousers back",
            },
        },
    }, null, 4)}\n`;
}

function terminal(sourceText: string, tagId: number) {
    return {
        schemaVersion: "nbook.semantic-tag-resolution/v1" as const,
        kind: "canonical" as const,
        sourceText,
        indexVersion: "db3k-demo",
        policyVersion: "safe-demo",
        resolverVersion: "resolver-demo",
        resolverPolicyVersion: "resolver-policy-demo",
        capabilityVersion: "nai-cap-demo",
        providerKind: "novelai" as const,
        modelScope: {kind: "generic-novelai" as const},
        candidateSetHash: null,
        resolvedAt: "2026-07-17T00:00:00.000Z",
        matchedBy: "exact" as const,
        canonical: {tagId, canonicalName: sourceText.replaceAll(" ", "_")},
        decisionProvenance: {selectedBy: "exact" as const, conceptQueriesHash: null},
    };
}

class MemoryStore implements CharacterVisualMigrationFileStore {
    readonly files = new Map<string, string>([
        ["lorebook/character/hero/index.md", "# 主角\n"],
        ["lorebook/character/hero/image-tags.md", characterMarkdown()],
        ["lorebook/character/hero/outfits/travel.md", outfitMarkdown()],
    ]);
    readonly writes: Array<{projectPath: ProjectPath; filePath: string}> = [];
    failOncePath: string | null = null;
    private failed = false;

    async resolveProjectRoot(): Promise<AbsoluteFsPath> {
        return absoluteFsPath("C:/project");
    }

    assertProjectOpen(_projectPath: ProjectPath, _root: AbsoluteFsPath): void {}

    async listPaths(_root: AbsoluteFsPath, prefix: string): Promise<string[]> {
        return [...this.files.keys()].filter((filePath) => filePath.startsWith(prefix)).sort();
    }

    async read(_root: AbsoluteFsPath, filePath: string): Promise<string | null> {
        return this.files.get(filePath) ?? null;
    }

    async readBytes(_root: AbsoluteFsPath, filePath: string): Promise<Uint8Array | null> {
        const content = this.files.get(filePath);
        return content === undefined ? null : new TextEncoder().encode(content);
    }

    async write(input: {projectPath: ProjectPath; root: AbsoluteFsPath; filePath: string; content: string; knownBefore: string | null}): Promise<void> {
        if (input.filePath === this.failOncePath && !this.failed) {
            this.failed = true;
            throw new Error("simulated interruption");
        }
        expect(this.files.get(input.filePath) ?? null).toBe(input.knownBefore);
        this.writes.push({projectPath: input.projectPath, filePath: input.filePath});
        this.files.set(input.filePath, input.content);
    }

    invalidate(_input: {projectPath: ProjectPath; root: AbsoluteFsPath}): void {}
}

function readyResolver(): CharacterVisualMigrationResolver {
    let sequence = 3000;
    return {
        async resolveExplicitImportTag(input) {
            sequence += 1;
            return {
                state: "terminal",
                run: {
                    schemaVersion: "nbook.tag-resolution-run/v1",
                    state: "terminal_canonical",
                    runId: input.runId,
                    resolutionId: input.resolutionId,
                    contextId: input.contextId,
                    sourceText: input.sourceText,
                    modelScope: input.modelScope,
                    createdAt: "2026-07-17T00:00:00.000Z",
                    updatedAt: "2026-07-17T00:00:00.000Z",
                    terminal: terminal(input.sourceText, sequence),
                },
                reviewApproval: null,
            };
        },
    };
}

async function prepared(store = new MemoryStore(), resolver = readyResolver()) {
    const service = new CharacterVisualMigrationService({store, resolver, now: () => "2026-07-20T00:00:00.000Z"});
    const scan = await service.scan({projectPath: "workspace/demo"});
    expect(scan).toEqual({
        items: [{characterPath: "lorebook/character/hero/image-tags.md", status: "legacy", outfitCount: 1}],
        sourcePaths: [],
        pendingMigrations: [],
    });
    const snapshot = await service.prepare({projectPath: "workspace/demo", characterPath: scan.items[0]!.characterPath});
    return {service, store, snapshot};
}

describe("Character visual migration service", () => {
    it("Director report_result 只持久化 proposal，字段决策后进入同一 migration candidate", async () => {
        const store = new MemoryStore();
        const service = new CharacterVisualMigrationService({
            store,
            resolver: readyResolver(),
            now: () => "2026-07-20T00:00:00.000Z",
        });
        const sourceCharacterFileHash = createTextToImageMarkdownFileHash(store.files.get("lorebook/character/hero/index.md")!);
        const preview = await service.saveDirectorProposal({
            projectPath: "workspace/demo",
            sourceCharacterPath: "lorebook/character/hero/index.md",
            sourceCharacterFileHash,
            sessionId: 21,
            invocationId: "director-invocation-21",
            proposal: {
                schemaVersion: "nbook.character-visual-director-proposal/v1",
                operation: "propose-character-visual",
                state: "completed",
                summary: "已生成角色视觉 proposal。",
                sourceCharacterFileHash,
                character: {
                    names: {cn: "主角", en: "hero"},
                    fields: {
                        profileTraits: "brave",
                        facialAppearance: "sharp eyes",
                        facialBack: "",
                        upperSfw: "white shirt",
                        upperBackSfw: "",
                        lowerSfw: "black trousers",
                        lowerBackSfw: "",
                        upperNsfw: "",
                        upperBackNsfw: "",
                        lowerNsfw: "",
                        lowerBackNsfw: "",
                        negativePrompt: "",
                    },
                },
                outfits: [],
                diagnostics: [],
            },
        });
        expect(preview.targetStatus).toBe("legacy");
        expect(store.writes).toContainEqual(expect.objectContaining({
            projectPath: "workspace/demo",
            filePath: expect.stringMatching(/^\.nbook\/text-to-image\/character-visual-proposals\//u),
        }));
        expect(preview.rows.find((row) => row.field === "profileTraits")?.state).toBe("conflict");
        expect([...store.files.keys()].some((filePath) => filePath.endsWith("/proposal.json"))).toBe(true);
        expect(store.files.get("lorebook/character/hero/image-tags.md")).toBe(characterMarkdown());

        const snapshot = await service.prepareDirectorProposal({
            projectPath: "workspace/demo",
            proposalId: preview.proposalId,
            expectedPreviewHash: preview.previewHash,
            decisions: preview.rows.filter((row) => row.decisionRequired)
                .map((row) => ({field: row.field, choice: "use_proposal" as const})),
        });
        expect(snapshot.candidate.source).toMatchObject({
            kind: "illustration_director_character",
            proposalId: preview.proposalId,
            profileKey: "illustration.director",
        });
        expect(snapshot.stage).toBe("pending_unresolved");
        expect((await service.scan({projectPath: "workspace/demo"})).pendingMigrations).toEqual([{
            migrationId: snapshot.candidate.migrationId,
            characterPath: "lorebook/character/hero/image-tags.md",
            stage: "pending_unresolved",
            sourceKind: "illustration_director_character",
        }]);
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: snapshot.candidate.migrationId,
            expectedPreviewToken: snapshot.previewToken,
            approvals: [],
        });
        store.files.set("lorebook/character/hero/index.md", "# 用户在 proposal 后修改角色事实\n");
        await expect(service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        })).rejects.toMatchObject({code: "SOURCE_FILE_STALE"});
        expect(store.files.get("lorebook/character/hero/image-tags.md")).toBe(characterMarkdown());
    });

    it("strict inspect 只列出公开明文源与真实 Project 角色目标", async () => {
        const store = new MemoryStore();
        store.files.set("upload/ttp.json", ttpCharacterSource());
        store.files.set("upload/not-json.txt", "ignored");
        store.files.set("lorebook/character/mage/index.md", "# 法师\n");
        const service = new CharacterVisualMigrationService({store, resolver: readyResolver()});

        const scan = await service.scan({projectPath: "workspace/demo"});
        expect(scan.sourcePaths).toEqual(["upload/ttp.json"]);
        const inspection = await service.inspectSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
        });
        expect(inspection.source.state).toBe("proposal_ready");
        expect(inspection.source.characters).toHaveLength(1);
        expect(inspection.targets).toEqual([
            {characterPath: "lorebook/character/hero/image-tags.md", characterId: "hero", status: "legacy"},
            {characterPath: "lorebook/character/mage/image-tags.md", characterId: "mage", status: "missing_visual"},
        ]);
    });

    it("外部源字段冲突必须逐项显式选择，prepare 复用统一 candidate/resolution", async () => {
        const store = new MemoryStore();
        store.files.set("upload/ttp.json", ttpCharacterSource());
        const service = new CharacterVisualMigrationService({
            store,
            resolver: readyResolver(),
            now: () => "2026-07-20T00:00:00.000Z",
        });
        const inspection = await service.inspectSource({projectPath: "workspace/demo", sourcePath: "upload/ttp.json"});
        const sourceCharacterId = inspection.source.characters[0]!.sourceCharacterId;
        const preview = await service.previewSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: "lorebook/character/hero/image-tags.md",
        });
        expect(preview.rows.find((row) => row.field === "profileTraits")).toMatchObject({state: "conflict", decisionRequired: true});
        expect(preview.rows.find((row) => row.field === "facialAppearance")).toMatchObject({state: "same", decisionRequired: false});
        expect(preview.outfits[0]!.targetPath).toMatch(/\/outfits\/ttp-outfit-[a-f0-9]{24}\.md$/u);
        store.files.set("lorebook/character/hero/outfits/travel.md", `${outfitMarkdown()}\n用户在预览后修改\n`);
        await expect(service.prepareSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: preview.characterPath,
            expectedMergePreviewHash: preview.mergePreviewHash,
            decisions: [],
        })).rejects.toMatchObject({code: "MIGRATION_STALE"});

        store.files.set("lorebook/character/hero/outfits/travel.md", outfitMarkdown());
        await expect(service.prepareSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: preview.characterPath,
            expectedMergePreviewHash: preview.mergePreviewHash,
            decisions: [],
        })).rejects.toMatchObject({code: "MIGRATION_INVALID"});

        const snapshot = await service.prepareSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: preview.characterPath,
            expectedMergePreviewHash: preview.mergePreviewHash,
            decisions: preview.rows.filter((row) => row.decisionRequired)
                .map((row) => ({field: row.field, choice: "use_proposal" as const})),
        });
        expect(snapshot.candidate.source).toMatchObject({
            kind: "ttp_character_export",
            sourcePath: "upload/ttp.json",
            mergePreviewHash: preview.mergePreviewHash,
        });
        expect(snapshot.stage).toBe("pending_unresolved");
        expect(store.files.get("lorebook/character/hero/image-tags.md")).toBe(characterMarkdown());
    });

    it("missing_visual 目标与外部服装均 create-only，apply 前源 bytes 漂移会零覆盖", async () => {
        const store = new MemoryStore();
        store.files.set("upload/ttp.json", ttpCharacterSource());
        store.files.set("lorebook/character/mage/index.md", "# 法师\n");
        const service = new CharacterVisualMigrationService({
            store,
            resolver: readyResolver(),
            now: () => "2026-07-20T00:00:00.000Z",
        });
        const inspection = await service.inspectSource({projectPath: "workspace/demo", sourcePath: "upload/ttp.json"});
        const sourceCharacterId = inspection.source.characters[0]!.sourceCharacterId;
        const preview = await service.previewSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: "lorebook/character/mage/image-tags.md",
        });
        const preparedSnapshot = await service.prepareSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: preview.characterPath,
            expectedMergePreviewHash: preview.mergePreviewHash,
            decisions: [],
        });
        expect(preparedSnapshot.candidate.character.targetBaseFileHash).toBeNull();
        expect(preparedSnapshot.candidate.outfits.every((outfit) => outfit.targetBaseFileHash === null)).toBe(true);
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: preparedSnapshot.candidate.migrationId,
            expectedPreviewToken: preparedSnapshot.previewToken,
            approvals: [],
        });
        store.files.set("upload/ttp.json", ttpCharacterSource("changed after prepare"));
        await expect(service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        })).rejects.toMatchObject({code: "SOURCE_FILE_STALE"});
        expect(store.files.has("lorebook/character/mage/image-tags.md")).toBe(false);
        expect([...store.files.keys()].some((filePath) => filePath.startsWith("lorebook/character/mage/outfits/"))).toBe(false);
    });

    it("外部源 missing_visual proposal 通过统一 Resolver 与 create-only journal 写入 V2", async () => {
        const store = new MemoryStore();
        store.files.set("upload/ttp.json", ttpCharacterSource());
        store.files.set("lorebook/character/mage/index.md", "# 法师\n");
        const service = new CharacterVisualMigrationService({
            store,
            resolver: readyResolver(),
            now: () => "2026-07-20T00:00:00.000Z",
        });
        const inspection = await service.inspectSource({projectPath: "workspace/demo", sourcePath: "upload/ttp.json"});
        const sourceCharacterId = inspection.source.characters[0]!.sourceCharacterId;
        const preview = await service.previewSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: "lorebook/character/mage/image-tags.md",
        });
        const proposal = await service.prepareSource({
            projectPath: "workspace/demo",
            sourcePath: "upload/ttp.json",
            sourceCharacterId,
            characterPath: preview.characterPath,
            expectedMergePreviewHash: preview.mergePreviewHash,
            decisions: [],
        });
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: proposal.candidate.migrationId,
            expectedPreviewToken: proposal.previewToken,
            approvals: [],
        });
        const applied = await service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        });
        expect(applied.stage).toBe("applied");
        expect(parseCharacterImageTagsMarkdown(store.files.get("lorebook/character/mage/image-tags.md")!).character.characterId).toBe("mage");
        const externalOutfitPath = applied.candidate.outfits[0]!.path;
        expect(parseOutfitTagsMarkdown(store.files.get(externalOutfitPath)!).outfit.ownerCharacterId).toBe("mage");
        const journal = [...store.files.entries()].find(([filePath]) => filePath.endsWith("/apply-journal.json"));
        expect(JSON.parse(journal![1]).writes.every((write: {sourceHash: string | null}) => write.sourceHash === null)).toBe(true);
    });

    it("prepare 只持久化 proposal/report；索引不可用时旧文件保持不变", async () => {
        const store = new MemoryStore();
        const resolver: CharacterVisualMigrationResolver = {
            async resolveExplicitImportTag() {
                throw new Error("active Tag index 不存在");
            },
        };
        const {service, snapshot} = await prepared(store, resolver);
        expect(snapshot.stage).toBe("pending_unresolved");
        expect([...store.files.keys()].some((filePath) => filePath.endsWith("/candidate.json"))).toBe(true);
        expect([...store.files.keys()].some((filePath) => filePath.endsWith("/report.json"))).toBe(true);
        await expect(service.resolve({
            projectPath: "workspace/demo",
            migrationId: snapshot.candidate.migrationId,
            expectedPreviewToken: snapshot.previewToken,
            approvals: [],
        })).rejects.toThrow(/active Tag index/u);
        expect(store.files.get("lorebook/character/hero/image-tags.md")).toBe(characterMarkdown());
        expect((await service.read({projectPath: "workspace/demo", migrationId: snapshot.candidate.migrationId})).stage)
            .toBe("pending_unresolved");
    });

    it("resolve 生成可审查 typed diff，apply 要求逐项接受并升级全部 V2 文件", async () => {
        const {service, store, snapshot} = await prepared();
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: snapshot.candidate.migrationId,
            expectedPreviewToken: snapshot.previewToken,
            approvals: [],
        });
        expect(resolved.stage).toBe("ready");
        expect(resolved.resolutions).toHaveLength(resolved.candidate.pendingAtoms.length);
        await expect(service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.slice(1).map((item) => item.resolutionKey),
        })).rejects.toBeInstanceOf(CharacterVisualMigrationError);

        const receipt = await service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        });
        expect(receipt.stage).toBe("applied");
        expect(parseCharacterImageTagsMarkdown(store.files.get("lorebook/character/hero/image-tags.md")!).character.characterId).toBe("hero");
        expect(parseOutfitTagsMarkdown(store.files.get("lorebook/character/hero/outfits/travel.md")!).outfit.ownerCharacterId).toBe("hero");
        const journal = [...store.files.entries()].find(([filePath]) => filePath.endsWith("/apply-journal.json"));
        expect(JSON.parse(journal![1]).state).toBe("completed");
    });

    it("源文件 CAS 漂移时零覆盖", async () => {
        const {service, store, snapshot} = await prepared();
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: snapshot.candidate.migrationId,
            expectedPreviewToken: snapshot.previewToken,
            approvals: [],
        });
        store.files.set("lorebook/character/hero/outfits/travel.md", `${outfitMarkdown()}\n用户新修改\n`);
        await expect(service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        })).rejects.toMatchObject({code: "SOURCE_FILE_STALE"});
        expect(store.files.get("lorebook/character/hero/image-tags.md")).toBe(characterMarkdown());
    });

    it("写入中断后按 journal 幂等恢复，不重复覆盖已升级文件", async () => {
        const store = new MemoryStore();
        const {service, snapshot} = await prepared(store);
        const resolved = await service.resolve({
            projectPath: "workspace/demo",
            migrationId: snapshot.candidate.migrationId,
            expectedPreviewToken: snapshot.previewToken,
            approvals: [],
        });
        store.failOncePath = "lorebook/character/hero/outfits/travel.md";
        await expect(service.apply({
            projectPath: "workspace/demo",
            migrationId: resolved.candidate.migrationId,
            expectedPreviewToken: resolved.previewToken,
            acceptedResolutionKeys: resolved.resolutions.map((item) => item.resolutionKey),
        })).rejects.toThrow("simulated interruption");
        expect(() => parseCharacterImageTagsMarkdown(store.files.get("lorebook/character/hero/image-tags.md")!)).not.toThrow();

        const resumed = await service.resume({projectPath: "workspace/demo", migrationId: resolved.candidate.migrationId});
        expect(resumed.stage).toBe("applied");
        expect(() => parseOutfitTagsMarkdown(store.files.get("lorebook/character/hero/outfits/travel.md")!)).not.toThrow();
    });
});
