import {randomBytes} from "node:crypto";
import type {H3Event} from "h3";
import {getCurrentUser, isAuthEnabled, requireCurrentUser} from "nbook/server/utils/auth";
import {prisma} from "nbook/server/utils/prisma";
import {hashUserPassword} from "nbook/server/utils/password";

/** 本地无鉴权模式兜底用户的唯一用户名。 */
const LOCAL_TEXT_TO_IMAGE_USERNAME = "local-text-to-image";

/**
 * 文生图 API 访问守卫：鉴权关闭时按本地单用户放行，不要求登录；
 * 鉴权开启时仍要求登录，避免暴露 Provider 与凭据管理接口。
 */
export async function requireTextToImageUser(event: H3Event): Promise<{id: number}> {
    if (!isAuthEnabled()) {
        const sessionUser = await getCurrentUser(event);
        if (sessionUser) {
            return {id: sessionUser.id};
        }
        const existing = await prisma.user.findFirst({
            where: {status: "active"},
            orderBy: {id: "asc"},
            select: {id: true},
        });
        if (existing) {
            return {id: existing.id};
        }
        const passwordHash = await hashUserPassword(randomBytes(24).toString("hex"));
        const created = await prisma.user.create({
            data: {
                username: LOCAL_TEXT_TO_IMAGE_USERNAME,
                displayName: "本地文生图用户",
                passwordHash,
                role: "user",
                status: "active",
            },
        });
        return {id: created.id};
    }
    return await requireCurrentUser(event);
}
