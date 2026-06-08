import {ProjectRagEventWriteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {createProjectRagEvent} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 新增 subject event。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagEventWriteRequestDtoSchema);
    const result = await createProjectRagEvent(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
