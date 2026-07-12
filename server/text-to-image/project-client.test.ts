import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {registerProjectResourceOwner, resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {
    closeTextToImageProjectClient,
    textToImageProjectClient,
    textToImageProjectClientResourceOwner,
} from "nbook/server/text-to-image/project-client";

describe("文生图 Project Prisma client", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath = "";

    beforeEach(async () => {
        resetProjectSessionsForTest();
        registerProjectResourceOwner(textToImageProjectClientResourceOwner);
        assets = await createIsolatedWorkspaceAssets();
    });

    afterEach(async () => {
        if (projectPath) {
            await closeProjectForTest(projectPath).catch(() => undefined);
            await closeTextToImageProjectClient(projectPath).catch(() => undefined);
        }
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("随 ProjectSession 打开，并可幂等关闭后重新连接", async () => {
        projectPath = `workspace/text-to-image-${randomUUID()}`;
        await writeProjectManifest(projectPath, {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(projectPath);

        const first = await textToImageProjectClient(projectPath);
        const second = await textToImageProjectClient(projectPath);
        expect(second).toBe(first);
        expect(await first.textToImageJob.count()).toBe(0);

        await closeProjectForTest(projectPath);
        await expect(textToImageProjectClient(projectPath)).rejects.toMatchObject({name: "ProjectNotOpenError"});

        await openProjectForTest(projectPath);
        expect(await (await textToImageProjectClient(projectPath)).textToImageJob.count()).toBe(0);
    });
});
