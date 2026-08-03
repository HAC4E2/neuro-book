import type {H3Event} from "h3";
import {isAuthEnabled, requireCurrentUser} from "nbook/server/utils/auth";

/** 本地无鉴权模式使用的文生图 Provider owner id。 */
const LOCAL_TEXT_TO_IMAGE_USER_ID = 1;

/**
 * 文生图 API 访问守卫：鉴权关闭时按本地单用户放行，不要求登录；
 * 鉴权开启时仍要求登录，避免暴露 Provider 与凭据管理接口。
 */
export async function requireTextToImageUser(event: H3Event): Promise<{id: number}> {
    if (!isAuthEnabled()) {
        return {id: LOCAL_TEXT_TO_IMAGE_USER_ID};
    }
    return await requireCurrentUser(event);
}
