import {ProjectRagSearchRequestDtoSchema, ProjectRagSearchResultDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {searchProjectSubjectRag} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 使用真实 subject RAG 链路搜索当前 subject。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagSearchRequestDtoSchema);
    const result = await searchProjectSubjectRag(requireProjectPathQuery(event), body);
    return ProjectRagSearchResultDtoSchema.parse(result);
});
