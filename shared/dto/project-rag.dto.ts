import {z} from "zod";

const ProjectRagSubjectPathSchema = z.string()
    .trim()
    .min(1, "subjectPath 不能为空")
    .regex(/^simulation\/subjects\/[^/]+$/u, "subjectPath 必须形如 simulation/subjects/<subject-id>");

const ProjectRagTextSchema = z.string().trim().min(1, "text 不能为空");
const ProjectRagSourceSchema = z.enum(["events", "memory"]);

export const ProjectRagIndexStatusDtoSchema = z.enum(["synced", "dirty", "error", "not_indexed", "unknown"]);

export const ProjectRagSourceStatusDtoSchema = z.object({
    source: ProjectRagSourceSchema,
    status: ProjectRagIndexStatusDtoSchema,
    recordCount: z.number().int().nonnegative(),
    indexedAt: z.string().nullable(),
    lastError: z.string().nullable(),
});

export const ProjectRagSubjectSummaryDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    subjectId: z.string().trim().min(1),
    eventCount: z.number().int().nonnegative(),
    memoryCount: z.number().int().nonnegative(),
    subjectFileExists: z.boolean(),
    mindFileExists: z.boolean(),
    stateFileExists: z.boolean(),
    sourceStatuses: z.array(ProjectRagSourceStatusDtoSchema),
    errors: z.array(z.object({
        source: ProjectRagSourceSchema,
        message: z.string(),
    })),
});

export const ProjectRagOverviewDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    subjects: z.array(ProjectRagSubjectSummaryDtoSchema),
});

export const ProjectRagEventDtoSchema = z.object({
    line: z.number().int().positive(),
    tick: z.string().optional(),
    time: z.string().optional(),
    text: ProjectRagTextSchema,
});

export const ProjectRagMemoryDtoSchema = z.object({
    line: z.number().int().positive(),
    topic: z.string().trim().min(1, "topic 不能为空"),
    aliases: z.array(z.string().trim().min(1)).optional(),
    view: z.string().trim().min(1, "view 不能为空"),
});

export const ProjectRagSubjectDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    subjectPath: ProjectRagSubjectPathSchema,
    subjectId: z.string().trim().min(1),
    events: z.array(ProjectRagEventDtoSchema),
    memories: z.array(ProjectRagMemoryDtoSchema),
    sourceStatuses: z.array(ProjectRagSourceStatusDtoSchema),
    errors: z.array(z.object({
        source: ProjectRagSourceSchema,
        message: z.string(),
    })),
});

export const ProjectRagSearchRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    query: ProjectRagTextSchema,
    sources: z.array(ProjectRagSourceSchema).min(1).optional(),
    limit: z.number().int().min(1).max(20).optional(),
});

export const ProjectRagSearchResultDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    subjectPath: ProjectRagSubjectPathSchema,
    candidates: z.array(z.object({
        source: ProjectRagSourceSchema,
        text: z.string(),
        topic: z.string().optional(),
        tick: z.string().optional(),
        time: z.string().optional(),
        rank: z.number().int().positive(),
        sourcePath: z.string(),
    })),
});

export const ProjectRagRebuildRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema.optional(),
});

export const ProjectRagRebuildResultDtoSchema = z.object({
    projectPath: z.string().trim().min(1),
    rebuiltSubjects: z.number().int().nonnegative(),
    skippedSubjects: z.number().int().nonnegative(),
    results: z.array(z.object({
        subjectPath: ProjectRagSubjectPathSchema,
        ok: z.boolean(),
        message: z.string().nullable(),
    })),
});

export const ProjectRagEventInputDtoSchema = z.object({
    tick: z.string().optional(),
    time: z.string().optional(),
    text: ProjectRagTextSchema,
});

export const ProjectRagEventWriteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    index: z.number().int().nonnegative().optional(),
    event: ProjectRagEventInputDtoSchema,
});

export const ProjectRagEventDeleteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    index: z.number().int().nonnegative(),
});

export const ProjectRagEventReorderRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    fromIndex: z.number().int().nonnegative(),
    toIndex: z.number().int().nonnegative(),
});

export const ProjectRagMemoryInputDtoSchema = z.object({
    topic: z.string().trim().min(1, "topic 不能为空"),
    aliases: z.array(z.string().trim().min(1)).optional(),
    view: z.string().trim().min(1, "view 不能为空"),
});

export const ProjectRagMemoryWriteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    topic: z.string().trim().min(1, "topic 不能为空").optional(),
    memory: ProjectRagMemoryInputDtoSchema,
});

export const ProjectRagMemoryDeleteRequestDtoSchema = z.object({
    subjectPath: ProjectRagSubjectPathSchema,
    topic: z.string().trim().min(1, "topic 不能为空"),
});

export type ProjectRagIndexStatusDto = z.infer<typeof ProjectRagIndexStatusDtoSchema>;
export type ProjectRagSourceStatusDto = z.infer<typeof ProjectRagSourceStatusDtoSchema>;
export type ProjectRagSubjectSummaryDto = z.infer<typeof ProjectRagSubjectSummaryDtoSchema>;
export type ProjectRagOverviewDto = z.infer<typeof ProjectRagOverviewDtoSchema>;
export type ProjectRagEventDto = z.infer<typeof ProjectRagEventDtoSchema>;
export type ProjectRagMemoryDto = z.infer<typeof ProjectRagMemoryDtoSchema>;
export type ProjectRagSubjectDto = z.infer<typeof ProjectRagSubjectDtoSchema>;
export type ProjectRagSearchRequestDto = z.infer<typeof ProjectRagSearchRequestDtoSchema>;
export type ProjectRagSearchResultDto = z.infer<typeof ProjectRagSearchResultDtoSchema>;
export type ProjectRagRebuildRequestDto = z.infer<typeof ProjectRagRebuildRequestDtoSchema>;
export type ProjectRagRebuildResultDto = z.infer<typeof ProjectRagRebuildResultDtoSchema>;
export type ProjectRagEventWriteRequestDto = z.infer<typeof ProjectRagEventWriteRequestDtoSchema>;
export type ProjectRagEventDeleteRequestDto = z.infer<typeof ProjectRagEventDeleteRequestDtoSchema>;
export type ProjectRagEventReorderRequestDto = z.infer<typeof ProjectRagEventReorderRequestDtoSchema>;
export type ProjectRagMemoryWriteRequestDto = z.infer<typeof ProjectRagMemoryWriteRequestDtoSchema>;
export type ProjectRagMemoryDeleteRequestDto = z.infer<typeof ProjectRagMemoryDeleteRequestDtoSchema>;
