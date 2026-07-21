import {describe, expect, it} from "vitest";
import {
    ConfigModelSettingsDtoSchema,
    GlobalConfigUpdateDtoSchema,
    ProjectConfigDtoSchema,
} from "nbook/shared/dto/config.dto";

const baseModelSettings = {
    defaultModelKey: null,
    defaultModelLabel: null,
    enabledModels: [],
    providers: [],
};

describe("illustration Director config contracts", () => {
    it("模型设置快照保留只读 Director binding 摘要", () => {
        const parsed = ConfigModelSettingsDtoSchema.parse({
            ...baseModelSettings,
            illustrationDirector: {
                bindingId: "illustration.director",
                configured: true,
                modelKey: "openai/gpt-5",
                providerId: "openai",
                providerName: "OpenAI",
                modelId: "gpt-5",
                modelName: "GPT-5",
            },
        });

        expect(parsed.illustrationDirector).toEqual({
            bindingId: "illustration.director",
            configured: true,
            modelKey: "openai/gpt-5",
            providerId: "openai",
            providerName: "OpenAI",
            modelId: "gpt-5",
            modelName: "GPT-5",
        });
    });

    it("Director binding 摘要拒绝 NovelAI 生成参数", () => {
        expect(() => ConfigModelSettingsDtoSchema.parse({
            ...baseModelSettings,
            illustrationDirector: {
                bindingId: "illustration.director",
                configured: false,
                modelKey: null,
                providerId: null,
                providerName: null,
                modelId: null,
                modelName: null,
                sampler: "k_euler_ancestral",
            },
        })).toThrow();
    });

    it("模型设置快照拒绝顶层 NovelAI Recipe 数据", () => {
        expect(() => ConfigModelSettingsDtoSchema.parse({
            ...baseModelSettings,
            novelAi: {
                recipeId: "recipe/default",
                steps: 28,
            },
        })).toThrow();
    });

    it("Project Config 拒绝覆盖 Director model binding", () => {
        expect(() => ProjectConfigDtoSchema.parse({
            agent: {
                profiles: {
                    "illustration.director": {
                        model: {modelKey: "project/model"},
                    },
                },
            },
        })).toThrow("Director model binding");
    });

    it("Project Config 仍允许 Director 的 project-scoped settings", () => {
        const parsed = ProjectConfigDtoSchema.parse({
            agent: {
                profiles: {
                    "illustration.director": {
                        settings: {storyboardId: "storyboard/default"},
                    },
                },
            },
        });

        expect(parsed.agent?.profiles?.["illustration.director"]?.settings).toEqual({
            storyboardId: "storyboard/default",
        });
    });

    it("Project Config 独占严格 illustration.tagPolicy，Global/Recipe 字段均被拒绝", () => {
        const parsed = ProjectConfigDtoSchema.parse({
            illustration: {
                tagPolicy: {contentScope: "all", unknownTagPolicy: "review_required"},
            },
        });
        expect(parsed.illustration?.tagPolicy).toEqual({
            contentScope: "all",
            unknownTagPolicy: "review_required",
        });
        expect(() => ProjectConfigDtoSchema.parse({
            illustration: {
                tagPolicy: {
                    contentScope: "general",
                    unknownTagPolicy: "provider_passthrough",
                    rules: [],
                },
            },
        })).toThrow();
        expect(() => ProjectConfigDtoSchema.parse({
            illustration: {
                tagPolicy: {contentScope: "general", unknownTagPolicy: "provider_passthrough"},
                recipe: {steps: 28},
            },
        })).toThrow();
        expect(() => GlobalConfigUpdateDtoSchema.parse({
            illustration: {tagPolicy: {contentScope: "general", unknownTagPolicy: "provider_passthrough"}},
        })).toThrow();
    });
});
