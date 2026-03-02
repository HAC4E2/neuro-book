import {listNovels} from "nbook/server/utils/novel-chapter";
import {prisma} from "nbook/server/utils/prisma";

/**
 * 查询小说列表。
 */
export default defineEventHandler(async () => listNovels(prisma));
