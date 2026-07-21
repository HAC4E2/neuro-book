import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    convertStoryboardImport,
    inspectStoryboardImport,
    listStoryboardImportSources,
    readStoryboardImportPreview,
    resolveStoryboardImportTags,
} from "nbook/server/text-to-image/storyboard-import.service";
import {StoryboardImportJournalSchema} from "nbook/server/text-to-image/storyboard-import-journal";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {
    resolveProjectAbsolutePath,
    writeProjectManifest,
} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceAssetRootContextForTest} from "nbook/server/workspace-files/workspace-assets-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import type {ProjectTagPolicyConfig} from "nbook/shared/text-to-image-tag-policy";
import {buildTagIndexVersion} from "nbook/server/text-to-image/tag-index/tag-index-builder";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {
    createTagIndexTestSnapshot,
    createTagIndexTestTerms,
} from "nbook/server/text-to-image/tag-index/tag-index-test-fixture";
import {normalizeTagIndexSnapshot} from "nbook/server/text-to-image/tag-index/tag-index-normalizer";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";

describe("Storyboard import Project inspect/journal", () => {
    let tempRoot: string;
    let workspaceRoot: string;
    let projectPath: string;
    let projectRoot: string;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = path.join(os.tmpdir(), `nbook-storyboard-import-${randomUUID()}`);
        workspaceRoot = path.join(tempRoot, "global-workspace");
        await fs.mkdir(path.join(tempRoot, "workspace"), {recursive: true});
        setWorkspaceAssetRootContextForTest({workspaceContainerRoot: path.join(tempRoot, "workspace")});
        vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
        projectPath = "workspace/storyboard-import";
        await writeProjectManifest(projectPath, {kind: "novel", title: "导入测试", summary: ""});
        await openProjectForTest(projectPath);
        projectRoot = resolveProjectAbsolutePath(projectPath);
        await fs.mkdir(path.join(projectRoot, "upload"), {recursive: true});
    });

    afterEach(async () => {
        await closeProjectForTest(projectPath).catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceAssetRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        vi.restoreAllMocks();
        await fs.rm(tempRoot, {recursive: true, force: true}).catch(() => undefined);
    }, 60_000);

    it("只接受当前 Project 顶层 upload/*.json，拒绝绝对路径、嵌套路径和其他扩展名", async () => {
        await writeSource("storyboard.json", createSource());
        await writeSource("another.json", createSource());
        await fs.writeFile(path.join(projectRoot, "upload", "notes.txt"), "not json", "utf8");
        await fs.mkdir(path.join(projectRoot, "upload", "nested"));
        await writeSource("nested/ignored.json", createSource());

        await expect(listStoryboardImportSources({projectPath})).resolves.toEqual({
            schemaVersion: "nbook.storyboard-import-source-list/v1",
            sources: [
                expect.objectContaining({relativePath: "upload/another.json"}),
                expect.objectContaining({relativePath: "upload/storyboard.json"}),
            ],
        });

        for (const invalidPath of [
            path.join(projectRoot, "upload", "storyboard.json"),
            "upload/nested/storyboard.json",
            "upload/storyboard.txt",
            "manuscript/storyboard.json",
        ]) {
            await expect(inspectStoryboardImport({
                projectPath,
                sourceRelativePath: invalidPath,
                workspaceRoot,
                converterVersion: "route-b-p2.1",
            })).rejects.toMatchObject({code: "STORYBOARD_IMPORT_PATH_INVALID"});
        }
    });

    it("持久化前完成脱敏；inspect manifest 不复制完整 content，同源重复 inspect 恢复同 importId", async () => {
        await writeSource("storyboard.json", createSource());
        const first = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const repeated = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const importRoot = globalImportRoot(first.importId);
        const sanitized = await fs.readFile(path.join(importRoot, "source.sanitized.json"), "utf8");
        const inspectManifest = await fs.readFile(path.join(importRoot, "inspect.json"), "utf8");
        const journal = StoryboardImportJournalSchema.parse(JSON.parse(
            await fs.readFile(path.join(importRoot, "journal.json"), "utf8"),
        ));

        expect(repeated.importId).toBe(first.importId);
        expect(sanitized).not.toContain("super-secret-token");
        expect(sanitized).toContain("选择有视觉价值的分镜");
        expect(inspectManifest).not.toContain("选择有视觉价值的分镜");
        expect(inspectManifest).not.toContain("super-secret-token");
        expect(journal.stage).toBe("inspect_written");
        expect(journal.source.rawSourceHash).toBe(first.inspection.rawSourceHash);
    });

    it("journal 阶段可重放：文件已写但阶段回退时只校验并推进，不覆盖冲突内容", async () => {
        await writeSource("storyboard.json", createSource());
        const first = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const journalPath = path.join(globalImportRoot(first.importId), "journal.json");
        const journal = StoryboardImportJournalSchema.parse(JSON.parse(await fs.readFile(journalPath, "utf8")));
        await fs.writeFile(journalPath, `${JSON.stringify({...journal, stage: "prepared"}, null, 4)}\n`, "utf8");

        await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const recovered = StoryboardImportJournalSchema.parse(JSON.parse(await fs.readFile(journalPath, "utf8")));
        expect(recovered.stage).toBe("inspect_written");

        await fs.writeFile(path.join(globalImportRoot(first.importId), "inspect.json"), "conflicting bytes", "utf8");
        await fs.writeFile(journalPath, `${JSON.stringify({...recovered, stage: "archive_written"}, null, 4)}\n`, "utf8");
        await expect(inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        })).rejects.toMatchObject({code: "STORYBOARD_IMPORT_ARCHIVE_CONFLICT"});
    });

    it("成对写入 pending candidates/report 并幂等恢复；来源改变后旧 import 明确失败", async () => {
        await writeSource("storyboard.json", createSource());
        const inspected = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const [core, scene] = inspected.inspection.entries;
        if (!core || !scene) throw new Error("fixture entries 缺失");
        const conversion = {
            schemaVersion: "nbook.storyboard-conversion-output/v1" as const,
            rules: [{
                kind: "shot-selection" as const,
                semanticSlot: "primary" as const,
                sourceEntryId: core.sourceIdentity.sourceEntryId,
                order: 1,
                enabled: true,
                when: {mode: "always" as const, any: [], andAny: []},
                provenance: {conversion: "derived" as const, sourcePaths: [`${core.sourceIdentity.jsonPointer}/content`]},
                effect: {
                    operation: "prefer" as const,
                    beatTypes: ["establishing" as const],
                    distribution: "balanced" as const,
                    scoreDelta: 10,
                },
            }],
            patterns: [{
                patternKind: "scene-recipe" as const,
                semanticSlot: "primary" as const,
                sourceEntryId: scene.sourceIdentity.sourceEntryId,
                sourcePath: `${scene.sourceIdentity.jsonPointer}/content`,
                order: 2,
                enabled: true,
                retrieval: {
                    mode: "trigger" as const,
                    any: ["雨夜"],
                    andAny: [],
                    characterCount: {min: 0, max: 3},
                    canvasIntents: ["landscape" as const],
                    ratingScopes: ["general" as const],
                    providerKinds: ["novelai" as const],
                    modelScopes: [{kind: "generic-novelai" as const}],
                },
                intent: {
                    scene: "scene.rain",
                    composition: "composition.wide",
                    lighting: "lighting.backlit",
                    action: "action.standing",
                },
                tags: {
                    scene: ["rainy alley"],
                    composition: ["wide shot"],
                    lighting: ["backlighting"],
                    action: ["standing"],
                    negativeGlobal: ["lowres"],
                    negativeCharacter: [],
                },
                confidence: 0.9,
                provenance: {conversion: "normalized" as const, sourcePaths: [`${scene.sourceIdentity.jsonPointer}/content`]},
            }],
            recipeProposals: [],
            diagnostics: [],
        };
        const input = {
            projectPath,
            sourceRelativePath: "upload/storyboard.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
            expectedImportId: inspected.importId,
            conversion,
        };
        const first = await convertStoryboardImport(input);
        const repeated = await convertStoryboardImport(input);
        const files = await fs.readdir(globalImportRoot(inspected.importId));

        expect(repeated.package.candidatePackageHash).toBe(first.package.candidatePackageHash);
        expect(files.sort()).toEqual([
            "candidate.storyboard.md",
            "candidate.tag-patterns.md",
            "inspect.json",
            "journal.json",
            "report.md",
            "source.sanitized.json",
        ]);
        const completed = StoryboardImportJournalSchema.parse(JSON.parse(
            await fs.readFile(path.join(globalImportRoot(inspected.importId), "journal.json"), "utf8"),
        ));
        expect(completed.stage).toBe("completed");
        expect(completed.package?.candidatePackageHash).toBe(first.package.candidatePackageHash);
        const preview = await readStoryboardImportPreview({importId: inspected.importId, workspaceRoot});
        expect(preview.package.candidatePackageHash).toBe(first.package.candidatePackageHash);
        expect(preview.storyboardMarkdown).toContain("nbook.storyboard-preset/v1");
        expect(preview.patternMarkdown).toContain("nbook.pending-tag-pattern-set/v1");
        expect(preview.approval).toEqual(expect.objectContaining({enabled: false, code: "TAG_INDEX_NOT_READY"}));

        await expect(convertStoryboardImport({
            ...input,
            conversion: {
                ...conversion,
                recipeProposals: [{
                    sourceEntryId: scene.sourceIdentity.sourceEntryId,
                    sourcePath: `${scene.sourceIdentity.jsonPointer}/content`,
                    positiveAtoms: ["cinematic lighting"],
                    negativeAtoms: [],
                    ignoredProviderParameters: ["steps=28"],
                    summary: "只读 Recipe 迁移提议",
                }],
            },
        })).rejects.toMatchObject({code: "STORYBOARD_IMPORT_CONVERSION_CONFLICT"});

        await writeSource("storyboard.json", createSource("内容已改变"));
        await expect(convertStoryboardImport(input)).rejects.toMatchObject({code: "STORYBOARD_IMPORT_SOURCE_CHANGED"});

        await fs.writeFile(path.join(projectRoot, "upload", "storyboard.json"), "{invalid json", "utf8");
        await expect(convertStoryboardImport(input)).rejects.toMatchObject({code: "STORYBOARD_IMPORT_SOURCE_CHANGED"});
    });

    it("真实 Resolver 把 review gate 逐项批准为 resolved companion，并从 prepared journal 恢复", async () => {
        const converted = await prepareConvertedImport();
        const pendingPreview = await readStoryboardImportPreview({importId: converted.package.importId, workspaceRoot});
        if (pendingPreview.state !== "pending_unresolved") throw new Error("fixture 必须先处于 pending_unresolved");
        const policy: ProjectTagPolicyConfig = {contentScope: "general", unknownTagPolicy: "review_required"};
        const resolver = await createResolver(policy);

        const gate = await resolveStoryboardImportTags({
            importId: converted.package.importId,
            projectPath,
            workspaceRoot,
            expectedPreviewToken: pendingPreview.previewToken,
            approvals: [],
        }, {resolver});
        expect(gate).toMatchObject({state: "review_required", approval: {enabled: false, code: "TAG_POLICY_REVIEW_REQUIRED"}});
        if (gate.state !== "review_required") throw new Error("fixture 必须进入 review_required");
        expect(gate.entries).toHaveLength(2);

        const resolved = await resolveStoryboardImportTags({
            importId: converted.package.importId,
            projectPath,
            workspaceRoot,
            expectedPreviewToken: gate.previewToken,
            approvals: gate.entries.map((entry, index) => {
                if (entry.outcome !== "review_required") throw new Error("fixture 不应包含 blocked atom");
                return {
                    reviewRequestHash: entry.review.reviewRequestHash,
                    approvalId: `approval-import-${index + 1}`,
                    actorId: "user-a",
                    reason: "逐项确认导入标签",
                };
            }),
        }, {resolver});
        expect(resolved).toMatchObject({
            state: "pending",
            approval: {enabled: true},
            package: {resolutionCounts: {providerPassthrough: 2, policyApprovals: 2}},
        });
        if (resolved.state !== "pending") throw new Error("fixture 必须进入 resolved pending");
        expect(resolved.patternMarkdown).toContain("nbook.tag-pattern-set/v1");
        expect(resolved.patternMarkdown).not.toContain("nbook.pending-tag-pattern-set/v1");
        expect(resolved.package.previewToken).not.toBe(pendingPreview.previewToken);

        const journalPath = path.join(globalImportRoot(converted.package.importId), "journal.json");
        const resolvedJournal = StoryboardImportJournalSchema.parse(JSON.parse(await fs.readFile(journalPath, "utf8")));
        expect(resolvedJournal.resolution.state).toBe("resolved");
        if (resolvedJournal.resolution.state !== "resolved") throw new Error("fixture resolution 必须为 resolved");
        await fs.writeFile(
            journalPath,
            `${JSON.stringify({...resolvedJournal, resolution: {...resolvedJournal.resolution, state: "prepared"}}, null, 4)}\n`,
            "utf8",
        );
        for (const fileName of ["resolved.storyboard.md", "resolved.tag-patterns.md", "resolved.diff.json"]) {
            await fs.rm(path.join(globalImportRoot(converted.package.importId), fileName));
        }
        const recovered = await resolveStoryboardImportTags({
            importId: converted.package.importId,
            projectPath,
            workspaceRoot,
            expectedPreviewToken: gate.previewToken,
            approvals: [],
        }, {resolver});
        expect(recovered).toMatchObject({state: "pending", package: {previewToken: resolved.package.previewToken}});
        const recoveredJournal = StoryboardImportJournalSchema.parse(JSON.parse(await fs.readFile(journalPath, "utf8")));
        expect(recoveredJournal.resolution.state).toBe("resolved");
    });

    /** 创建一个只含两个未知普通 Tag 的 pending import，便于覆盖 passthrough/review 边界。 */
    async function prepareConvertedImport() {
        await writeSource("resolve.json", createSource());
        const inspected = await inspectStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/resolve.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
        });
        const [core, scene] = inspected.inspection.entries;
        if (!core || !scene) throw new Error("fixture entries 缺失");
        return convertStoryboardImport({
            projectPath,
            sourceRelativePath: "upload/resolve.json",
            workspaceRoot,
            converterVersion: "route-b-p2.1",
            expectedImportId: inspected.importId,
            conversion: {
                schemaVersion: "nbook.storyboard-conversion-output/v1",
                rules: [{
                    kind: "shot-selection",
                    semanticSlot: "primary",
                    sourceEntryId: core.sourceIdentity.sourceEntryId,
                    order: 1,
                    enabled: true,
                    when: {mode: "always", any: [], andAny: []},
                    provenance: {conversion: "derived", sourcePaths: [`${core.sourceIdentity.jsonPointer}/content`]},
                    effect: {operation: "prefer", beatTypes: ["establishing"], distribution: "balanced", scoreDelta: 10},
                }],
                patterns: [{
                    patternKind: "scene-recipe",
                    semanticSlot: "primary",
                    sourceEntryId: scene.sourceIdentity.sourceEntryId,
                    sourcePath: `${scene.sourceIdentity.jsonPointer}/content`,
                    order: 2,
                    enabled: true,
                    retrieval: {
                        mode: "trigger",
                        any: ["雨夜"],
                        andAny: [],
                        characterCount: {min: 0, max: 3},
                        canvasIntents: ["landscape"],
                        ratingScopes: ["general"],
                        providerKinds: ["novelai"],
                        modelScopes: [{kind: "generic-novelai"}],
                    },
                    intent: {
                        scene: "scene.rain",
                        composition: "composition.wide",
                        lighting: "lighting.night",
                        action: "action.standing",
                    },
                    tags: {
                        scene: ["silver-blue atmospheric haze"],
                        composition: ["cinematic depth framing"],
                        lighting: [],
                        action: [],
                        negativeGlobal: [],
                        negativeCharacter: [],
                    },
                    confidence: 0.9,
                    provenance: {conversion: "normalized", sourcePaths: [`${scene.sourceIdentity.jsonPointer}/content`]},
                }],
                recipeProposals: [],
                diagnostics: [],
            },
        });
    }

    /** 在当前 Workspace Root 安装测试 active index，并创建绑定当前 Project policy 的 Resolver。 */
    async function createResolver(policy: ProjectTagPolicyConfig): Promise<TagResolverService> {
        const tagRoot = path.join(workspaceRoot, ".nbook", "cache", "text-to-image", "tags");
        const snapshot = createTagIndexTestSnapshot();
        const normalized = normalizeTagIndexSnapshot({snapshot, capabilityVersion: "nai-cap-v1"});
        const ready = await buildTagIndexVersion({
            root: tagRoot,
            snapshot,
            normalized,
            terms: createTagIndexTestTerms(),
        });
        const tagStore = new TagIndexStore({root: tagRoot, now: () => 1_784_505_600_000, lockRetryDelayMs: 1});
        await tagStore.activateVersion({
            indexVersion: ready.manifest.indexVersion,
            manifestHash: ready.manifestHash,
            expectedCurrentHash: null,
        });
        return new TagResolverService({
            reader: new TagIndexReader({root: tagRoot}),
            policyRegistry: new TagPolicyRegistryService(),
            capabilityVersion: "nai-cap-v1",
            resolveProjectPolicy: async () => policy,
            now: () => 1_784_505_600_000,
        });
    }

    async function writeSource(fileName: string, value: object): Promise<void> {
        await fs.writeFile(path.join(projectRoot, "upload", fileName), JSON.stringify(value), "utf8");
    }

    function globalImportRoot(importId: string): string {
        return path.join(
            workspaceRoot,
            ".nbook",
            "agents",
            "illustration.director",
            "imports",
            "chatu8-storyboard",
            importId,
        );
    }
});

function createSource(coreContent = "选择有视觉价值的分镜"): object {
    return {
        entries: [
            {id: "core", role: "system", enabled: true, content: coreContent, apiKey: "super-secret-token"},
            {
                id: "scene",
                role: "user",
                enabled: true,
                triggerMode: "trigger",
                triggerWords: ["雨夜"],
                content: "rainy alley, wide shot, backlighting, standing",
            },
        ],
    };
}
