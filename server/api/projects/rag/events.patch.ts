import {ProjectRagEventWriteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {updateProjectRagEvent} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 修改 subject event。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagEventWriteRequestDtoSchema);
    const result = await updateProjectRagEvent(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
