import {describe, expect, it} from "vitest";
import {
    requestLlmCompletion,
    type RequestLlmCompletionInput,
} from "nbook/server/text-to-image/llm-chat";
import {
    buildCharacterVisualSystemPrompt,
    buildCharacterVisualUserPrompt,
    generateCharacterVisualDraft,
    generateCharacterVisualModifyPreview,
    mergeCharacterVisualPatch,
    parseCharacterVisualDraftPresence,
    parseCharacterVisualDraft,
    parseCharacterVisualDraftBatch,
} from "nbook/server/text-to-image/character-visual-llm";

describe("character visual llm", () => {
    it("modify_visual 只应用返回中出现的字段，并锁定角色身份与指定服装", () => {
        const current = parseCharacterVisualDraft(JSON.stringify({
            characterId: "xiaoke",
            character: {
                cnName: "小克",
                enName: "Xiao Ke",
                triggerWords: "小克, Xiao Ke",
                facialAppearance: "long black hair",
                profileTraits: "gentle",
            },
            outfits: [{cnName: "校服", enName: "School Uniform", upper: "white shirt", lower: "navy skirt"}],
            photos: ["assets/tti/keep.png"],
        }));
        const presence = parseCharacterVisualDraftPresence(JSON.stringify({
            character: {cnName: "别改我", profileTraits: "brave"},
            outfits: [{upper: "black coat"}],
        }));

        const result = mergeCharacterVisualPatch(current, presence, 0);

        expect(result.visual.character.cnName).toBe("小克");
        expect(result.visual.character.facialAppearance).toBe("long black hair");
        expect(result.visual.character.profileTraits).toBe("brave");
        expect(result.visual.outfits[0]?.upper).toBe("black coat");
        expect(result.visual.outfits[0]?.lower).toBe("navy skirt");
        expect(result.visual.photos).toEqual(["assets/tti/keep.png"]);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("纯服装回复只返回候选，不因默认选中索引覆盖当前服装", () => {
        const current = parseCharacterVisualDraft(JSON.stringify({
            characterId: "fixture",
            character: {cnName: "测试角色", enName: "Fixture", triggerWords: "测试角色"},
            outfits: [{cnName: "原有服装", enName: "Existing", upper: "old shirt", lower: "old skirt"}],
            photos: [],
        }));
        const parsed = parseCharacterVisualDraftPresence([
            "：角色的服装。",
            "<服装>",
            "中文名称:第一套新服装",
            "英文名称:first new outfit",
            "上半身:white shirt",
            "下半身:navy skirt",
            "</服装>",
            "<服装>",
            "中文名称:第二套新服装",
            "英文名称:second new outfit",
            "上半身:black coat",
            "下半身:black trousers",
            "</服装>",
        ].join("\n"));
        expect(parsed.characterFields.size).toBe(0);
        expect(parsed.draft.outfits).toHaveLength(2);
        const candidates = parsed.draft.outfits.map((outfit, index) => ({
            candidateId: `outfit-${index + 1}`,
            sourceOrder: index,
            outfit,
            fields: [...(parsed.outfitFields[index] ?? [])],
            warnings: [],
        }));
        expect(candidates.map((item) => item.outfit.cnName)).toEqual(["第一套新服装", "第二套新服装"]);
        expect(current.outfits[0]?.cnName).toBe("原有服装");
    });

    it("修改预览把纯服装回复转为候选，并保留当前视觉基线", async () => {
        const current = JSON.stringify({
            schema: "nbook.character-visual/v1",
            characterId: "fixture",
            character: {cnName: "测试角色", enName: "Fixture", triggerWords: "测试角色"},
            outfits: [{cnName: "原有服装", enName: "Existing", upper: "old shirt", lower: "old skirt"}],
            photos: [],
        });
        const result = await generateCharacterVisualModifyPreview({
            provider: {baseUrl: "https://api.example.com/v1", credential: "sk-test", settings: {model: "gpt-4o"}},
            characterId: "fixture",
            characterPage: "角色页",
            existingSummary: current,
            userRequirement: "生成角色的服装",
        }, async () => [
            "<服装>",
            "中文名称:精致校服",
            "英文名称:sophisticated uniform",
            "上半身:white shirt, navy blazer",
            "下半身:navy pleated skirt",
            "</服装>",
        ].join("\n"));

        expect(result.mode).toBe("outfit_only");
        expect(result.visual.outfits[0]?.cnName).toBe("原有服装");
        expect(result.outfitCandidates).toHaveLength(1);
        expect(result.outfitCandidates?.[0]?.outfit.enName).toBe("sophisticated uniform");
    });

    it("parses multiple character design results and keeps unassigned outfits as standalone drafts", () => {
        const result = parseCharacterVisualDraftBatch(JSON.stringify({
            characters: [
                {characterId: "alice", character: {cnName: "Alice", enName: "Alice"}, outfits: [{cnName: "礼服", upper: "dress"}]},
                {characterId: "bob", character: {cnName: "Bob", enName: "Bob"}},
            ],
            outfits: [
                {cnName: "披风", enName: "Cape", upper: "red cape", owner: "Bob"},
                {cnName: "通用制服", upper: "uniform"},
            ],
        }));

        expect(result.drafts.map((draft) => draft.characterId)).toEqual(["alice", "bob"]);
        expect(result.drafts[0]?.outfits.map((outfit) => outfit.cnName)).toEqual(["礼服"]);
        expect(result.drafts[1]?.outfits.map((outfit) => outfit.cnName)).toEqual(["披风"]);
        expect(result.standaloneOutfits.map((item) => item.outfit.cnName)).toEqual(["通用制服"]);
        expect(result.standaloneOutfits[0]?.sourceOrder).toBeGreaterThan(result.drafts.length);
    });

    it("parses multiple labeled character blocks without truncating the first character", () => {
        const result = parseCharacterVisualDraftBatch([
            "<人物>",
            "中文名称: Alice",
            "英文名称: Alice",
            "五官外貌: blue eyes",
            "</人物>",
            "<人物>",
            "中文名称: Bob",
            "英文名称: Bob",
            "五官外貌: green eyes",
            "</人物>",
        ].join("\n"));

        expect(result.drafts).toHaveLength(2);
        expect(result.drafts[0]?.character.cnName).toBe("Alice");
        expect(result.drafts[1]?.character.facialAppearance).toBe("green eyes");
    });

    it("解析 JSON 角色草稿并映射中文字段", () => {
        const draft = parseCharacterVisualDraft(JSON.stringify({
            角色设计: {
                人物: {
                    中文名称: "小克",
                    英文名称: "Xiao Ke",
                    角色特征: "innocent, gentle",
                    五官外貌: "long black hair, ((sapphire blue eyes)), pale skin, young girl",
                    五官外貌背面: "long black hair, nape, pale skin, young girl",
                    上半身SFW: "petite, slender body, medium breasts",
                    上半身SFW背面: "shoulder blades, slim waist",
                    下半身SFW: "long legs, thick thighs",
                    下半身SFW背面: "hips, back of thighs",
                    上半身NSFW: "medium breasts, pink nipples",
                    上半身NSFW背面: "bare back, shoulder blades",
                    下半身NSFW: "pussy, pubic hair",
                    下半身NSFW背面: "buttocks, anus",
                    负面: "bad anatomy, extra fingers",
                },
                服装: [{
                    中文名称: "校服",
                    英文名称: "School Uniform",
                    上半身: "white shirt, navy vest",
                    上半身背面: "plain back",
                    下半身: "navy pleated skirt",
                    下半身背面: "plain back",
                }],
            },
        }));

        expect(draft.character.cnName).toBe("小克");
        expect(draft.character.facialBack).toContain("nape");
        expect(draft.character.negativePrompt).toContain("bad anatomy");
        expect(draft.outfits).toHaveLength(1);
        expect(draft.outfits[0]?.upperBack).toBe("plain back");
        expect(draft.schema).toBe("nbook.character-visual/v1");
    });

    it("解析 JSON 对象（schema 键）", () => {
        const draft = parseCharacterVisualDraft(JSON.stringify({
            character: {cnName: "小克", enName: "Xiao Ke"},
            outfits: [{cnName: "校服", upper: "white shirt"}],
        }));

        expect(draft.character.cnName).toBe("小克");
        expect(draft.outfits[0]?.upper).toBe("white shirt");
        expect(draft.character.facialAppearance).toBe("");
    });

    it("解析 <人物>/<服装> 行式草稿并支持多个服装", () => {
        const text = [
            "```",
            "<人物>",
            "中文名称: 小克",
            "英文名称: Xiao Ke",
            "五官外貌: long black hair, blue eyes",
            "五官外貌背面: long black hair, nape",
            "负面: bad anatomy",
            "</人物>",
            "<服装>",
            "中文名称: 校服",
            "英文名称: School Uniform",
            "上半身: white shirt",
            "上半身背面: plain back",
            "下半身: navy skirt",
            "下半身背面: plain back",
            "</服装>",
            "<服装>",
            "中文名称: 睡衣",
            "英文名称: Pajamas",
            "上半身: white pajamas shirt",
            "下半身: pink shorts",
            "</服装>",
            "```",
        ].join("\n");

        const draft = parseCharacterVisualDraft(text);
        expect(draft.character.cnName).toBe("小克");
        expect(draft.character.facialAppearance).toContain("blue eyes");
        expect(draft.outfits).toHaveLength(2);
        expect(draft.outfits[1]?.cnName).toBe("睡衣");
    });

    it("解析失败抛出含诊断的错误", () => {
        expect(() => parseCharacterVisualDraft("这是一段没有格式的输出")).toThrow(/解析失败/);
    });

    it("system prompt 包含字段、POV、SFW/NSFW 与 tag 语法", () => {
        const prompt = buildCharacterVisualSystemPrompt();
        expect(prompt).toContain("中文名称");
        expect(prompt).toContain("英文名称");
        expect(prompt).toContain("角色特征");
        expect(prompt).toContain("五官外貌背面");
        expect(prompt).toContain("上半身SFW背面");
        expect(prompt).toContain("上半身NSFW");
        expect(prompt).toContain("下半身NSFW背面");
        expect(prompt).toContain("负面");
        expect(prompt).toContain("上半身背面");
        expect(prompt).toContain("下半身背面");
        expect(prompt).toContain("(tag:1.5)");
        expect(prompt).toContain("互斥");
        expect(prompt).toContain("SFW");
        expect(prompt).toContain("NSFW");
    });

    it("user prompt 区分 fill_empty 与 replace_visual", () => {
        const fill = buildCharacterVisualUserPrompt({
            characterPage: "角色页",
            existingSummary: "",
            mode: "fill_empty",
        });
        const replace = buildCharacterVisualUserPrompt({
            characterPage: "角色页",
            existingSummary: "{}",
            mode: "replace_visual",
        });

        expect(fill).toContain("只补全为空");
        expect(replace).toContain("整体重写");
        expect(fill).toContain("角色页");
        expect(buildCharacterVisualUserPrompt({
            characterPage: "角色页",
            existingSummary: "{}",
            mode: "replace_visual",
            userRequirement: "改成黑色礼服",
        })).toContain("本次用户修改要求：改成黑色礼服");
    });

    it("generateCharacterVisualDraft 使用注入 complete 并返回完整文件", async () => {
        let lastInput: RequestLlmCompletionInput | undefined;
        const complete: typeof requestLlmCompletion = async (input) => {
            lastInput = input;
            return JSON.stringify({
                character: {cnName: "小克", facialAppearance: "long black hair, blue eyes"},
                outfits: [{cnName: "校服", upper: "white shirt"}],
            });
        };

        const visual = await generateCharacterVisualDraft({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {
                    model: "gpt-4o",
                    temperature: 0.8,
                    topP: 0.9,
                    maxTokens: 12000,
                    stream: false,
                    sendImages: false,
                    mergeSystemUser: false,
                    retryCount: 0,
                },
            },
            characterId: "char-1",
            characterPage: "角色页",
            existingSummary: "",
            mode: "fill_empty",
        }, complete);

        expect(visual.characterId).toBe("char-1");
        expect(visual.character.cnName).toBe("小克");
        expect(visual.outfits[0]?.upper).toBe("white shirt");
        expect(lastInput?.baseUrl).toBe("https://api.example.com/v1");
        expect(lastInput?.model).toBe("gpt-4o");
        expect(lastInput?.maxTokens).toBe(12000);
        expect(lastInput?.messages[0]?.role).toBe("system");
        expect(lastInput?.messages[1]?.role).toBe("user");
        expect(String(lastInput?.messages[1]?.content)).toContain("角色页");
    });

    it("fill_empty 保留既有非空字段", async () => {
        const complete: typeof requestLlmCompletion = async () => JSON.stringify({
            character: {cnName: "小克"},
        });

        const visual = await generateCharacterVisualDraft({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {model: "gpt-4o"},
            },
            characterId: "char-1",
            characterPage: "角色页",
            existingSummary: JSON.stringify({
                schema: "nbook.character-visual/v1",
                characterId: "char-1",
                character: {facialAppearance: "long black hair, blue eyes"},
                outfits: [],
                photos: ["assets/tti/avatar-1.png"],
            }),
            mode: "fill_empty",
        }, complete);

        expect(visual.character.cnName).toBe("小克");
        expect(visual.character.facialAppearance).toBe("long black hair, blue eyes");
        expect(visual.photos).toEqual(["assets/tti/avatar-1.png"]);
    });

    it("解析失败最多重试 2 次后成功", async () => {
        let calls = 0;
        const complete: typeof requestLlmCompletion = async () => {
            calls += 1;
            return calls === 1
                ? "这不是有效草稿"
                : JSON.stringify({character: {cnName: "小克"}});
        };

        const visual = await generateCharacterVisualDraft({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {model: "gpt-4o"},
            },
            characterId: "char-1",
            characterPage: "角色页",
            existingSummary: "",
            mode: "replace_visual",
        }, complete);

        expect(calls).toBe(2);
        expect(visual.character.cnName).toBe("小克");
    });

    it("连续解析失败抛错", async () => {
        let calls = 0;
        const complete: typeof requestLlmCompletion = async () => {
            calls += 1;
            return "坏输出";
        };

        await expect(generateCharacterVisualDraft({
            provider: {
                baseUrl: "https://api.example.com/v1",
                credential: "sk-test",
                settings: {model: "gpt-4o"},
            },
            characterId: "char-1",
            characterPage: "角色页",
            existingSummary: "",
            mode: "replace_visual",
        }, complete)).rejects.toThrow(/解析失败/);
        expect(calls).toBe(3);
    });
});
