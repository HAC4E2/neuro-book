import {requireAgentSessionId, snapshotAgentSessionAttachment} from "nbook/server/agent/http";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {AgentSessionAttachmentSnapshotRequestDtoSchema} from "nbook/shared/dto/agent-session.dto";

/** 将本地文件地址快照为稳定 Session Attachment。 */
export default defineEventHandler(async (event) => withProjectNotOpenHttpError(async () => {
    const body = await validateBody(event, AgentSessionAttachmentSnapshotRequestDtoSchema, {maxBytes: 16 * 1024});
    return snapshotAgentSessionAttachment(requireAgentSessionId(event), body);
}));
