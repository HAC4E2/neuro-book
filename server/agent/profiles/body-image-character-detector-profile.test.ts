import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import bodyImageCharacterDetectorProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/body-image.character-detector.profile";
import {
    BodyImageCharacterDetectorInitialSchema,
    BodyImageCharacterDetectorOutputSchema,
    BodyImageCharacterDetectorPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("body-image.character-detector profile", () => {
    it("catalog can load the compiled builtin profile", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const profile = await catalog.get("body-image.character-detector");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("正文生图角色识别");
        expect(snapshot.profiles.find((item) => item.key === "body-image.character-detector")).toEqual(expect.objectContaining({
            key: "body-image.character-detector",
            loadStatus: "loaded",
        }));
    }, 60_000);

    it("uses structured payload/output schemas and only exposes report_result", async () => {
        const prepared = await bodyImageCharacterDetectorProfile.prepare!({
            session: testSession({
                profileKey: "body-image.character-detector",
                workspaceRoot: resolve("workspace"),
                projectPath: "silver-dragon-hime",
                customState: {},
                linkedAgents: [],
                archived: false,
                planModeActive: false,
            }),
            initial: {},
            invocation: {
                caller: {kind: "user"},
                payload: {
                    chapterPath: "manuscript/001/index.md",
                    chapterMarkdown: "小明站在窗边。",
                    candidates: [{
                        id: "xiaoming",
                        sourcePath: "lorebook/character/xiaoming/image-tags.md",
                        cnName: "小明|明明",
                        cnAliases: ["小明", "明明"],
                        enName: "Xiao Ming",
                    }],
                },
                message: undefined,
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const appendingText = (prepared.appendingMessages ?? []).map((message) => messageText(message as never)).join("\n");

        expect(bodyImageCharacterDetectorProfile.initialSchema).toBe(BodyImageCharacterDetectorInitialSchema);
        expect(bodyImageCharacterDetectorProfile.payloadSchema).toBe(BodyImageCharacterDetectorPayloadSchema);
        expect(bodyImageCharacterDetectorProfile.outputSchema).toBe(BodyImageCharacterDetectorOutputSchema);
        expect(bodyImageCharacterDetectorProfile.rootToolKeys).toEqual(["report_result"]);
        expect(prepared.systemPrompt).toContain("正文生图角色识别子 agent");
        expect(prepared.systemPrompt).toContain("report_result.data");
        expect(appendingText).toContain("小明|明明");
        expect(appendingText).toContain("小明站在窗边");
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
        planModeActive: false,
        ...input,
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
