import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

const originalDefineEventHandler = (globalThis as typeof globalThis & {defineEventHandler?: unknown}).defineEventHandler;
const originalDefineRouteMeta = (globalThis as typeof globalThis & {defineRouteMeta?: unknown}).defineRouteMeta;

const serviceMocks = vi.hoisted(() => ({
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    previewDeleteGroup: vi.fn(),
    deleteGroupWithMigration: vi.fn(),
}));

let body: unknown;
let query: Record<string, string>;

describe("character-library groups endpoints", () => {
    beforeEach(() => {
        vi.resetModules();
        body = {};
        query = {};
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: <THandler>(handler: THandler) => THandler;
            defineRouteMeta?: (meta: unknown) => void;
        };
        globals.defineEventHandler = (handler) => handler;
        globals.defineRouteMeta = () => undefined;
        vi.doMock("nbook/server/text-to-image/auth", () => ({
            requireTextToImageUser: vi.fn(async () => ({id: 1})),
        }));
        // 用真实 Zod schema 解析测试注入的 body，并按 novel-chapter 的合同把失败投影为 400，
        // 验证 .strict() 拒绝浏览器提交 groupId。
        vi.doMock("nbook/server/utils/novel-chapter", () => ({
            validateBody: vi.fn(async (_event: unknown, schema: {safeParse: (input: unknown) => {success: boolean; data?: unknown; error?: {issues: Array<{message: string}>}}}) => {
                const result = schema.safeParse(body);
                if (!result.success) {
                    const error = new Error(result.error?.issues[0]?.message ?? "请求参数不合法");
                    Object.assign(error, {statusCode: 400});
                    throw error;
                }
                return result.data;
            }),
        }));
        vi.doMock("nbook/server/text-to-image/project-client", () => ({
            resolveTextToImageProjectRoot: vi.fn((projectRoot: string) => projectRoot),
        }));
        vi.doMock("nbook/server/text-to-image/character-visual-library.service", () => ({
            CharacterVisualLibraryService: class {
                createGroup = serviceMocks.createGroup;
                updateGroup = serviceMocks.updateGroup;
                previewDeleteGroup = serviceMocks.previewDeleteGroup;
                deleteGroupWithMigration = serviceMocks.deleteGroupWithMigration;
            },
            GroupNameConflictError: class GroupNameConflictError extends Error {
                readonly code = "TEXT_TO_IMAGE_GROUP_NAME_CONFLICT";
                constructor(name: string) {
                    super(`已存在同名分组：${name}`);
                    this.name = "GroupNameConflictError";
                }
            },
        }));
    });

    afterEach(() => {
        const globals = globalThis as typeof globalThis & {
            defineEventHandler?: unknown;
            defineRouteMeta?: unknown;
        };
        globals.defineEventHandler = originalDefineEventHandler;
        globals.defineRouteMeta = originalDefineRouteMeta;
        vi.doUnmock("nbook/server/text-to-image/auth");
        vi.doUnmock("nbook/server/utils/novel-chapter");
        vi.doUnmock("nbook/server/text-to-image/project-client");
        vi.doUnmock("nbook/server/text-to-image/character-visual-library.service");
        vi.clearAllMocks();
    });

    it("POST groups 只接收 projectRoot + name，服务端生成 ID", async () => {
        body = {projectRoot: "root", name: "故事后期"};
        serviceMocks.createGroup.mockResolvedValue({groupId: "group-1", name: "故事后期"});
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.post")).default;
        const result = await handler({} as never);
        expect(serviceMocks.createGroup).toHaveBeenCalledWith("root", {name: "故事后期", description: undefined});
        expect(result).toEqual({group: {groupId: "group-1", name: "故事后期"}});
    });

    it("POST groups 拒绝浏览器提交 groupId（strict schema）", async () => {
        body = {projectRoot: "root", name: "故事后期", groupId: "browser-id"};
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 400});
        expect(serviceMocks.createGroup).not.toHaveBeenCalled();
    });

    it("POST groups 同名冲突返回 409", async () => {
        body = {projectRoot: "root", name: "故事后期"};
        serviceMocks.createGroup.mockRejectedValue(new (await import("nbook/server/text-to-image/character-visual-library.service")).GroupNameConflictError("故事后期"));
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.post")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 409, message: "已存在同名分组：故事后期"});
    });

    it("PUT groups 重命名同名返回 409", async () => {
        body = {projectRoot: "root", groupId: "group-1", name: "故事后期"};
        serviceMocks.updateGroup.mockRejectedValue(new (await import("nbook/server/text-to-image/character-visual-library.service")).GroupNameConflictError("故事后期"));
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.put")).default;
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 409});
    });

    it("GET groups.delete-preview 返回只读影响摘要", async () => {
        query = {projectRoot: "root", groupId: "group-1"};
        serviceMocks.previewDeleteGroup.mockResolvedValue({
            groupId: "group-1",
            revision: "rev-1",
            characterCount: 2,
            visualCount: 3,
            invalidFileCount: 0,
            fileNameConflictCount: 1,
            visualIdConflictCount: 0,
            managedReferenceCount: 1,
            defaultEnabled: false,
        });
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.delete-preview.get")).default;
        const result = await handler({path: `/api/text-to-image/character-library/groups.delete-preview?projectRoot=${query.projectRoot}&groupId=${query.groupId}`} as never);
        expect(serviceMocks.previewDeleteGroup).toHaveBeenCalledWith("root", "group-1");
        expect(result).toMatchObject({revision: "rev-1", characterCount: 2});
    });

    it("DELETE groups 携带 expectedRevision，revision 冲突返回 409", async () => {
        body = {projectRoot: "root", groupId: "group-1", expectedRevision: "rev-1"};
        serviceMocks.deleteGroupWithMigration.mockResolvedValue({moved: {characterCount: 2, visualCount: 3}, refMap: []});
        const handler = (await import("nbook/server/api/text-to-image/character-library/groups.delete")).default;
        const result = await handler({} as never);
        expect(serviceMocks.deleteGroupWithMigration).toHaveBeenCalledWith("root", "group-1", "rev-1");
        expect(result).toEqual({moved: {characterCount: 2, visualCount: 3}, refMap: []});

        const {GroupMigrationRevisionConflictError} = await import("nbook/server/text-to-image/character-group-migration");
        serviceMocks.deleteGroupWithMigration.mockRejectedValue(new GroupMigrationRevisionConflictError("group-1"));
        await expect(handler({} as never)).rejects.toMatchObject({statusCode: 409});
    });
});
