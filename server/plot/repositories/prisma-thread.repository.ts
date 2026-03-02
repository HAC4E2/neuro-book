import type {StoryPhase, StoryScene, StoryThread} from "nbook/server/generated/prisma/client";
import type {ThreadRepository} from "nbook/server/plot/contracts/plot-repositories";
import type {PrismaExecutor, ResolvedStoryRefInput, StoryThreadWithRefs} from "nbook/server/plot/core/types";
import {STORY_THREAD_REF_INCLUDE} from "nbook/server/plot/repositories/includes";

/**
 * Prisma 版 Thread 仓储。
 */
export class PrismaThreadRepository implements ThreadRepository {
    constructor(private readonly prisma: PrismaExecutor) {}

    /**
     * 查询线程。
     */
    async findThreadById(threadId: number): Promise<StoryThread | null> {
        return this.prisma.storyThread.findUnique({
            where: {id: threadId},
        });
    }

    /**
     * 查询带 refs 的线程详情。
     */
    async findThreadWithRefsById(threadId: number): Promise<StoryThreadWithRefs | null> {
        return this.prisma.storyThread.findUnique({
            where: {id: threadId},
            include: {
                refs: {
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: STORY_THREAD_REF_INCLUDE,
                },
            },
        }) as Promise<StoryThreadWithRefs | null>;
    }

    /**
     * 返回 Story 下线程 ID。
     */
    async findThreadIdsByStory(storyId: number): Promise<number[]> {
        const threads = await this.prisma.storyThread.findMany({
            where: {storyId},
            select: {id: true},
        });
        return threads.map((thread) => thread.id);
    }

    /**
     * 按 bucket 列出线程。
     */
    async findThreadsByStoryPhase(storyId: number, storyPhaseId: number | null): Promise<StoryThread[]> {
        return this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
        });
    }

    /**
     * 按 name 查询线程。
     */
    async findThreadByName(storyId: number, name: string, excludeThreadId?: number): Promise<StoryThread | null> {
        return this.prisma.storyThread.findFirst({
            where: {
                storyId,
                name,
                ...(excludeThreadId ? {
                    NOT: {id: excludeThreadId},
                } : {}),
            },
        });
    }

    /**
     * 创建线程。
     */
    async createThread(input: {
        storyId: number;
        storyPhaseId: number | null;
        sortOrder: number;
        name: string;
        title: string;
        isMainThread: boolean;
        status: StoryThread["status"];
        summary: string;
        tags: string[];
        writingTip: string | null;
        note: string | null;
    }): Promise<StoryThread> {
        return this.prisma.storyThread.create({
            data: input,
        });
    }

    /**
     * 更新线程。
     */
    async updateThread(
        threadId: number,
        data: Partial<Pick<
            StoryThread,
            "storyPhaseId" | "sortOrder" | "name" | "title" | "isMainThread" | "status" | "summary" | "tags" | "writingTip" | "note"
        >>,
    ): Promise<StoryThread> {
        return this.prisma.storyThread.update({
            where: {id: threadId},
            data,
        });
    }

    /**
     * 删除线程。
     */
    async deleteThread(threadId: number): Promise<void> {
        await this.prisma.storyThread.delete({
            where: {id: threadId},
        });
    }

    /**
     * 全量替换线程 refs。
     */
    async replaceRefs(threadId: number, refs: ResolvedStoryRefInput[]): Promise<void> {
        await this.prisma.storyThreadRef.deleteMany({
            where: {threadId},
        });

        if (refs.length === 0) {
            return;
        }

        await this.prisma.storyThreadRef.createMany({
            data: refs.map((ref) => ({
                threadId,
                sortOrder: ref.sortOrder,
                relation: ref.relation,
                rawTarget: ref.rawTarget,
                targetKind: ref.targetKind,
                targetThreadId: ref.targetThreadId,
                targetSceneId: ref.targetSceneId,
                targetPlotId: ref.targetPlotId,
                visibility: ref.visibility,
                note: ref.note,
            })),
        });
    }

    /**
     * 返回指定阶段下的线程 ID。
     */
    async findThreadRefsOwnerIds(storyId: number, storyPhaseId: number): Promise<number[]> {
        const threads = await this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            select: {id: true},
        });
        return threads.map((thread) => thread.id);
    }

    /**
     * 按 name 解析 thread ref 目标。
     */
    async findThreadRefTargetByName(storyId: number, name: string): Promise<Pick<StoryThread, "id" | "name"> | null> {
        return this.prisma.storyThread.findFirst({
            where: {
                storyId,
                name,
            },
            select: {
                id: true,
                name: true,
            },
        });
    }

    /**
     * 查询未分组线程树。
     */
    async findUngroupedThreads(storyId: number): Promise<Array<StoryThread & {scenes: StoryScene[]}>> {
        return this.prisma.storyThread.findMany({
            where: {
                storyId,
                storyPhaseId: null,
            },
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                scenes: {
                    orderBy: [
                        {threadSortOrder: "asc"},
                        {id: "asc"},
                    ],
                },
            },
        });
    }

    /**
     * 查询阶段树。
     */
    async findPhaseThreadsWithScenes(storyId: number): Promise<Array<StoryPhase & {threads: Array<StoryThread & {scenes: StoryScene[]}>}>> {
        return this.prisma.storyPhase.findMany({
            where: {storyId},
            orderBy: [
                {sortOrder: "asc"},
                {id: "asc"},
            ],
            include: {
                threads: {
                    where: {storyId},
                    orderBy: [
                        {sortOrder: "asc"},
                        {id: "asc"},
                    ],
                    include: {
                        scenes: {
                            orderBy: [
                                {threadSortOrder: "asc"},
                                {id: "asc"},
                            ],
                        },
                    },
                },
            },
        });
    }
}
