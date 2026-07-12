import {resolve} from "node:path";
import {describe, expect, it} from "vitest";
import bodyImagePromptPlacerProfile from "../../../assets/workspace/.nbook/agent/profiles/builtin/body-image.prompt-placer.profile";
import {
    BodyImagePromptPlacerInitialSchema,
    BodyImagePromptPlacerOutputSchema,
    BodyImagePromptPlacerPayloadSchema,
} from "nbook/server/agent/profiles/builtin-contracts";
import {AgentProfileCatalog} from "nbook/server/agent/profiles/catalog";
import {defaultAgentProfile} from "nbook/server/agent/profiles/default-profile";
import {messageText} from "nbook/server/agent/messages/message-utils";
import type {RuntimeSessionFacade} from "nbook/server/agent/profiles/define-agent-runtime";
import type {NeuroSessionContext} from "nbook/server/agent/session/types";
import type {AgentDialogueContent} from "nbook/server/agent/session/dialogue-content";
import {createTestVariableAccessor} from "nbook/server/agent/variables/test-utils";

describe("body-image.prompt-placer profile", () => {
    it("catalog can load the compiled builtin profile", async () => {
        const catalog = new AgentProfileCatalog(
            resolve("assets", "workspace", ".nbook", "agent", "profiles"),
            resolve(".agent", "missing-user-profiles"),
        );
        catalog.register(defaultAgentProfile);
        const profile = await catalog.get("body-image.prompt-placer");
        const snapshot = await catalog.snapshot();

        expect(profile.manifest.name).toBe("正文生图插图定位");
        expect(snapshot.profiles.find((item) => item.key === "body-image.prompt-placer")).toEqual(expect.objectContaining({
            key: "body-image.prompt-placer",
            loadStatus: "loaded",
        }));
    }, 60_000);

    it("asks for paragraph placements and only exposes report_result", async () => {
        const prepared = await bodyImagePromptPlacerProfile.prepare!({
            session: testSession({
                profileKey: "body-image.prompt-placer",
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
                    chapterPath: "manuscript/001/index.md",
                    chapterMarkdown: "Alpha paragraph.\n\nBeta paragraph.",
                    paragraphs: [
                        {id: "p-1", index: 0, text: "Alpha paragraph."},
                        {id: "p-2", index: 1, text: "Beta paragraph."},
                    ],
                    prompts: [
                        {id: "prompt-1", order: 0, prompt: "Alpha scene", responseIndex: 0, nearbyText: ""},
                    ],
                    llmReply: "<image>Alpha scene</image>",
                },
                message: undefined,
            },
            vars: createTestVariableAccessor(),
            catalog: {profiles: [], issues: []},
            skills: [],
            settings: {},
        });
        const appendingText = (prepared.appendingMessages ?? []).map((message) => messageText(message as never)).join("\n");

        expect(bodyImagePromptPlacerProfile.initialSchema).toBe(BodyImagePromptPlacerInitialSchema);
        expect(bodyImagePromptPlacerProfile.payloadSchema).toBe(BodyImagePromptPlacerPayloadSchema);
        expect(bodyImagePromptPlacerProfile.outputSchema).toBe(BodyImagePromptPlacerOutputSchema);
        expect(bodyImagePromptPlacerProfile.rootToolKeys).toEqual(["report_result"]);
        expect(prepared.systemPrompt).toContain("正文生图插图定位子 agent");
        expect(prepared.systemPrompt).toContain("afterParagraphId");
        expect(appendingText).toContain("prompt-1");
        expect(appendingText).toContain("Alpha paragraph.");
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
