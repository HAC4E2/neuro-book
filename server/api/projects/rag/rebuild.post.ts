import {ProjectRagRebuildRequestDtoSchema, ProjectRagRebuildResultDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {rebuildProjectSubjectRag} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 重建当前 subject 或当前 Project 的 RAG 索引。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagRebuildRequestDtoSchema);
    const result = await rebuildProjectSubjectRag(requireProjectPathQuery(event), body);
    return ProjectRagRebuildResultDtoSchema.parse(result);
});
