import type {PassportLinkSessionDto} from "nbook/shared/dto/passport.dto";
import {PassportLinkStartRequestSchema, type PassportLinkStartRequestDto} from "nbook/shared/dto/passport.dto";
import {validateBody} from "nbook/server/utils/novel-chapter";
import {usePassportClient} from "nbook/server/passport/passport-client-service";

/**
 * 发起设备码关联：向官方站申请设备码，返回 userCode 与批准页链接。
 * deviceCode 留在服务端内存会话，不下发前端（spec §6.2）。
 */
export default defineEventHandler(async (event): Promise<PassportLinkSessionDto> => {
    const body = await validateBody<PassportLinkStartRequestDto>(event, PassportLinkStartRequestSchema);
    return await usePassportClient().startLink(body.siteBaseUrl);
});
