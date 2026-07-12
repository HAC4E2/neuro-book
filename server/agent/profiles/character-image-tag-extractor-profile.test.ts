import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import characterImageTagExtractorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/character-image-tag.extractor.profile";
import {
    CharacterImageTagExtractorInitialSchema,
    CharacterImageTagExtractorOutputSchema,
    CharacterImageTagExtractorPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("character-image-tag.extractor profile", () => {
    it("catalog can load the compiled builtin profile", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const profile = await catalog.get("character-image-tag.extractor");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("角色生图信息提取");
        expect(snapshot.profiles.find((item) => item.key === "character-image-tag.extractor")).toEqual(expect.objectContaining({
            key: "character-image-tag.extractor",
            loadStatus: "loaded",
        }));
    }, 60_000);

    it("asks for appearance facts and only exposes report_result", async () => {
        const prepared = await characterImageTagExtractorProfile.prepare!({
            session: testSession({
                profileKey: "character-image-tag.extractor",
                workspaceRoot: resolve("workspace"),
                projectPath: "silver-dragon-hime",
                customState: {},
                linkedAgents: [],
                archived: false,
            }),
            initial: {},
            invocation: {
                caller: {kind: "user"},
                payload: {
                    characterPath: "lorebook/character/xiaoming/index.md",
                    characterTitle: "小明",
                    characterMarkdown: "---\ntitle: 小明\n---\n\n金发棕眼，身形娇小。",
                },
                message: undefined,
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const appendingText = (prepared.appendingMessages ?? []).map((message) => messageText(message as never)).join("\n");

        expect(characterImageTagExtractorProfile.initialSchema).toBe(CharacterImageTagExtractorInitialSchema);
        expect(characterImageTagExtractorProfile.payloadSchema).toBe(CharacterImageTagExtractorPayloadSchema);
        expect(characterImageTagExtractorProfile.outputSchema).toBe(CharacterImageTagExtractorOutputSchema);
        expect(characterImageTagExtractorProfile.rootToolKeys).toEqual(["report_result"]);
        expect(prepared.systemPrompt).toContain("角色生图信息提取子 agent");
        expect(prepared.systemPrompt).toContain("appearanceFacts");
        expect(appendingText).toContain("金发棕眼");
    });
});

function testSession(input: Partial<NeuroSessionContext>): RuntimeSessionFacade {
    const session: RuntimeSessionFacade = {
        systemPrompt: "",
        messages: [],
        model: null,
        thinkingLevel: "off",
        profileKey: "test",
        workspaceRoot: "workspace",
        customState: {},
        linkedAgents: [],
        archived: false,
        ...input,
        agentMode: input.agentMode ?? "normal",
        async read() {
            return {
                snapshot: {
                    metadata: {
                        sessionId: -1,
                        profileKey: session.profileKey,
                        initial: {},
                        workspaceRoot: session.workspaceRoot,
                        workspaceKey: "test",
                        createdAt: 0,
                    },
                    entries: [],
                    leafId: null,
                },
                context: session,
            };
        },
        async agentDialogueContent(): Promise<AgentDialogueContent> {
            return {
                text: "",
                tokens: 0,
                fingerprint: "test",
                entryIds: [],
            };
        },
    };
    return session;
}
