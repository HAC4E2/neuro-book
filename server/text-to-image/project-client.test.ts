import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {closeProjectForTest, openProjectForTest} from "nbook/server/workspace-files/project-session-test-utils";
import {resetProjectSessionsForTest} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {textToImageProjectRef} from "nbook/server/text-to-image/compat";
import {resolveRuntimeWorkspaceRoot} from "nbook/server/workspace-files/workspace-runtime-root";
import {createIsolatedWorkspaceAssets, type IsolatedWorkspaceAssets} from "nbook/server/workspace-files/workspace-assets-test-helper";
import {textToImageProjectClient} from "nbook/server/text-to-image/project-client";

describe("文生图 Project Prisma client", () => {
    let assets: IsolatedWorkspaceAssets;
    let projectPath = "";

    beforeEach(async () => {
        resetProjectSessionsForTest();
        assets = await createIsolatedWorkspaceAssets();
    });

    afterEach(async () => {
        if (projectPath) {
            await closeProjectForTest(textToImageProjectRef(projectPath).projectRoot).catch(() => undefined);
        }
        resetProjectSessionsForTest();
        await assets.dispose();
    });

    it("随 ProjectSession 打开，并可幂等关闭后重新连接", async () => {
        projectPath = `workspace/text-to-image-${randomUUID()}`;
        await writeProjectManifest(resolveRuntimeWorkspaceRoot(), textToImageProjectRef(projectPath), {kind: "novel", title: "测试项目", summary: ""});
        await openProjectForTest(textToImageProjectRef(projectPath).projectRoot);

        const first = await textToImageProjectClient(projectPath);
        const second = await textToImageProjectClient(projectPath);
        expect(second).toBe(first);
        expect(await first.textToImageJob.count()).toBe(0);

        await closeProjectForTest(textToImageProjectRef(projectPath).projectRoot);
        await expect(textToImageProjectClient(projectPath)).rejects.toMatchObject({name: "ProjectNotOpenError"});

        await openProjectForTest(textToImageProjectRef(projectPath).projectRoot);
        expect(await (await textToImageProjectClient(projectPath)).textToImageJob.count()).toBe(0);
    });
});
