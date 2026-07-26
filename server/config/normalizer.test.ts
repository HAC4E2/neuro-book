import {describe, expect, it} from "vitest";
import {normalizeGlobalConfig, normalizeModelSettings, normalizeProjectConfig, resolveEffectiveConfig, serializeModelSettings} from "nbook/server/config/normalizer";
import type {StoredProjectConfig, StoredProviderConfig} from "nbook/server/config/types";

/** 创建模型 API 归一化用的完整 stored Provider fixture。 */
function modelApiProvider(modelApi: string | null, modelApis: Array<string | null>): StoredProviderConfig {
    return {
        id: "openai-compatible",
        name: "OpenAI Compatible",
        enabled: true,
        modelApi,
        options: {
            apiKey: "saved-secret",
            baseURL: "https://example.com/v1",
            proxy: "",
            timeoutMs: null,
            requestOptions: {},
        },
        models: modelApis.map((api, index) => ({
            id: `model-${String(index + 1)}`,
            name: `Model ${String(index + 1)}`,
            group: null,
            enabled: true,
            api,
            reasoning: false,
            input: ["text"],
            maxTokens: 8192,
            cost: null,
            compat: null,
            headers: null,
            thinkingLevelMap: null,
            contextWindowTokens: 65536,
        })),
    };
}

describe("config normalizer model API migration", () => {
    it("把旧版两级缺失的 Pi API 显式物化为旧运行时默认值", () => {
        const normalized = normalizeModelSettings({default: "openai-compatible/model-1", providers: [modelApiProvider(null, [null])]});
        const serialized = serializeModelSettings(normalized);

        expect(normalized.providers["openai-compatible"]?.modelApi).toBe("openai-completions");
        expect(normalized.providers["openai-compatible"]?.models["model-1"]?.api).toBe("openai-completions");
        expect(serialized.providers?.[0]?.modelApi).toBe("openai-completions");
        expect(serialized.providers?.[0]?.models[0]?.api).toBe("openai-completions");
    });

    it("用明确的 Provider API 补空模型但保留已有模型 API", () => {
        const normalized = normalizeModelSettings({providers: [modelApiProvider("openai-responses", [null, "anthropic-messages"])]});

        expect(normalized.providers["openai-compatible"]?.models["model-1"]?.api).toBe("openai-responses");
        expect(normalized.providers["openai-compatible"]?.models["model-2"]?.api).toBe("anthropic-messages");
    });

    it("保留无效的非空 Provider API 且不把它传播给模型", () => {
        const normalized = normalizeModelSettings({providers: [modelApiProvider("unsupported-api", [null])]});

        expect(normalized.providers["openai-compatible"]?.modelApi).toBe("unsupported-api");
        expect(normalized.providers["openai-compatible"]?.models["model-1"]?.api).toBeNull();
    });
});

describe("config normalizer theme", () => {
    it("允许内置 8 主题并保留自定义主题选择", () => {
        const global = normalizeGlobalConfig({
            ui: {
                theme: "custom-night",
                customThemes: [{
                    id: "custom-night",
                    name: "Night",
                    appearance: "dark",
                    vars: {
                        "bg-main": "#111111",
                        "accent-main": "#88ccff",
                        unknown: "#ffffff",
                    },
                } as never, {
                    id: "custom-night",
                    name: "Duplicate",
                    appearance: "light",
                    vars: {"bg-main": "#ffffff"},
                }],
            },
        });
        const effective = resolveEffectiveConfig(global, null);

        expect(effective.ui.theme).toBe("custom-night");
        expect(effective.ui.customThemes).toEqual([{
            id: "custom-night",
            name: "Night",
            appearance: "dark",
            vars: {
                "bg-main": "#111111",
                "accent-main": "#88ccff",
            },
        }]);
    });

    it("未知主题回退 sepia，但 tokyo-night 等内置主题保持有效", () => {
        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "tokyo-night"},
        }), null).ui.theme).toBe("tokyo-night");

        expect(resolveEffectiveConfig(normalizeGlobalConfig({
            ui: {theme: "missing-theme"},
        }), null).ui.theme).toBe("sepia");
    });
});

describe("config normalizer profile runtime", () => {
    const globalWithDisabled = normalizeGlobalConfig({
        agent: {
            profiles: {
                "leader.default": {
                    model: {},
                    runtime: {summarizer: {enabled: false}},
                },
            },
        },
    });

    it("仅 global 配置时 effective 保留 summarizer 开关", () => {
        const effective = resolveEffectiveConfig(globalWithDisabled, null);
        expect(effective.agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 空/非法 summarizer 不遮蔽 global 的禁用（enabled 字段级合并）", () => {
        const emptyProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, emptyProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});

        const invalidProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: "yes"}},
                    },
                },
            },
        } as never as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, invalidProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: false});
    });

    it("project 合法 summarizer 覆盖 global；双方未配置时不携带 key", () => {
        const enabledProject = {
            agent: {
                profiles: {
                    "leader.default": {
                        model: {},
                        runtime: {summarizer: {enabled: true}},
                    },
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(globalWithDisabled, enabledProject).agent.profiles["leader.default"]?.runtime?.summarizer).toEqual({enabled: true});

        const plainGlobal = normalizeGlobalConfig({
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        });
        const plainProject = {
            agent: {
                profiles: {
                    "leader.default": {model: {}},
                },
            },
        } as StoredProjectConfig;
        expect(resolveEffectiveConfig(plainGlobal, plainProject).agent.profiles["leader.default"]?.runtime).toEqual({});
    });

    it("默认使用 512，Project 可继承或覆盖 Global", () => {
        const global = normalizeGlobalConfig({
            agent: {profileRuntimeDefaults: {fileChangeNotice: {diffMaxChars: 1024}}},
        });
        expect(resolveEffectiveConfig(global, null).agent.profileRuntimeDefaults?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const inherited = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}}}}} as StoredProjectConfig);
        expect(inherited.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(1024);

        const overridden = resolveEffectiveConfig(global, {agent: {profiles: {writer: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}}}}} as StoredProjectConfig);
        expect(overridden.agent.profiles.writer?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);

        const defaults = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(defaults.agent.profileRuntimeDefaults).toEqual({});
    });

    it("接受 0 与 8192，非法或越界值不参与遮蔽", () => {
        const global = normalizeGlobalConfig({
            agent: {profiles: {
                min: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 0}}},
                max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 8192}}},
                invalid: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: 9000}}},
            }},
        });
        const effective = resolveEffectiveConfig(global, {
            agent: {profiles: {max: {model: {}, runtime: {fileChangeNotice: {diffMaxChars: -1}}}}},
        } as StoredProjectConfig);

        expect(effective.agent.profiles.min?.runtime?.fileChangeNotice?.diffMaxChars).toBe(0);
        expect(effective.agent.profiles.max?.runtime?.fileChangeNotice?.diffMaxChars).toBe(8192);
        expect(effective.agent.profiles.invalid?.runtime?.fileChangeNotice).toBeUndefined();
    });
});

describe("config normalizer workspace history", () => {
    it("默认值：enabled 开、90 天窗口、auto-accept 14 天", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({}), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("非法值回退默认：负数/小数天数与非布尔开关不参与遮蔽", () => {
        const effective = resolveEffectiveConfig(normalizeGlobalConfig({
            history: {
                enabled: "yes" as unknown as boolean,
                retentionFullDays: -3,
                autoAcceptDays: 2.5,
                keepDailyLastAfterWindow: "no" as unknown as boolean,
            },
        }), null);
        expect(effective.history).toEqual({
            enabled: true,
            retentionFullDays: 90,
            keepDailyLastAfterWindow: true,
            autoAcceptEnabled: true,
            autoAcceptDays: 14,
        });
    });

    it("project 覆盖 retention/auto-accept 子集；enabled 被结构性剥离不可遮蔽", () => {
        const global = normalizeGlobalConfig({
            history: {enabled: false, retentionFullDays: 30},
        });
        const project = {
            history: {
                retentionFullDays: 7,
                autoAcceptEnabled: false,
                // project 文件手写 enabled 也不会生效（patch 归一化不输出该字段）
                enabled: true,
            },
        } as StoredProjectConfig;
        const effective = resolveEffectiveConfig(global, project);
        expect(effective.history.enabled).toBe(false);
        expect(effective.history.retentionFullDays).toBe(7);
        expect(effective.history.autoAcceptEnabled).toBe(false);
        expect(effective.history.autoAcceptDays).toBe(14);
    });
});

describe("illustration Director model binding", () => {
    it("Project model 不能覆盖 Global binding，但 Project settings 仍参与合并", () => {
        const global = normalizeGlobalConfig({
            agent: {
                profiles: {
                    "illustration.director": {
                        model: {modelKey: "global/director-model"},
                        settings: {storyboardId: "storyboard/global"},
                    },
                },
            },
        });
        const project = {
            agent: {
                profiles: {
                    "illustration.director": {
                        model: {modelKey: "project/forbidden-model"},
                        settings: {storyboardId: "storyboard/project"},
                    },
                },
            },
        } as StoredProjectConfig;

        const effective = resolveEffectiveConfig(global, project);

        expect(effective.agent.profiles["illustration.director"]?.model.modelKey).toBe("global/director-model");
        expect(effective.agent.profiles["illustration.director"]?.settings).toEqual({
            storyboardId: "storyboard/project",
        });
    });

    it("Director runtime model 不继承 Global 或 Project 的通用 Profile 默认模型", () => {
        const global = normalizeGlobalConfig({
            agent: {
                profileModelDefaults: {modelKey: "global/shared-default"},
                profiles: {
                    "illustration.director": {
                        model: {modelKey: null},
                    },
                },
            },
        });
        const project = {
            agent: {
                profileModelDefaults: {modelKey: "project/shared-default"},
                profiles: {
                    "illustration.director": {
                        settings: {storyboardId: "storyboard/project"},
                    },
                },
            },
        } as StoredProjectConfig;

        expect(resolveEffectiveConfig(global, project).agent.profiles["illustration.director"]?.model.modelKey).toBeNull();
    });
});

describe("illustration Tag policy Project truth source", () => {
    it("uses the safe product default and only accepts a complete strict Project override", () => {
        const global = normalizeGlobalConfig({});
        expect(resolveEffectiveConfig(global, null).illustration.tagPolicy).toEqual({
            contentScope: "general",
            unknownTagPolicy: "provider_passthrough",
        });

        const project = normalizeProjectConfig({
            illustration: {
                tagPolicy: {contentScope: "all", unknownTagPolicy: "review_required"},
            },
        });
        expect(project.illustration?.tagPolicy).toEqual({
            contentScope: "all",
            unknownTagPolicy: "review_required",
        });
        expect(resolveEffectiveConfig(global, project).illustration.tagPolicy).toEqual(project.illustration?.tagPolicy);
        expect(() => normalizeProjectConfig({
            illustration: {
                tagPolicy: {contentScope: "general", unknownTagPolicy: "block"},
            },
        } as never)).toThrow();
    });
});
