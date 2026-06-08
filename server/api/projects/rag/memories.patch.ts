import {ProjectRagMemoryWriteRequestDtoSchema, ProjectRagSubjectDtoSchema} from "nbook/shared/dto/project-rag.dto";
import {updateProjectRagMemory} from "nbook/server/rag/project-rag-visualization";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";

/**
 * 修改 subject memory。
 */
export default defineEventHandler(async (event) => {
    const body = await validateBody(event, ProjectRagMemoryWriteRequestDtoSchema);
    const result = await updateProjectRagMemory(requireProjectPathQuery(event), body);
    return ProjectRagSubjectDtoSchema.parse(result);
});
