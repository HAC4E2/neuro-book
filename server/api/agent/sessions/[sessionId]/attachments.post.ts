import Busboy from "busboy";
import type {IncomingMessage} from "node:http";
import {createError, getRequestHeader} from "h3";
import {
    preflightAgentSessionAttachmentRegistration,
    requireAgentSessionId,
    uploadAgentSessionAttachment,
} from "nbook/server/agent/http";
import {withProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";
import {AGENT_IMAGE_POLICY} from "nbook/shared/agent/agent-image-policy";

const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

type UploadedFile = {
    bytes: Uint8Array;
    mimeType?: string;
    name: string;
};

/** 严格流式接收一个名为 file 的 multipart 图片，并登记到当前 Session。 */
export default defineEventHandler(async (event) => withProjectNotOpenHttpError(async () => {
    const sessionId = requireAgentSessionId(event);
    await preflightAgentSessionAttachmentRegistration(sessionId);

    const contentLength = Number.parseInt(getRequestHeader(event, "content-length") ?? "", 10);
    if (Number.isFinite(contentLength)
        && contentLength > AGENT_IMAGE_POLICY.maxImageBytes + MULTIPART_OVERHEAD_BYTES) {
        throw imageLimitError();
    }

    const file = await readSingleImage(event.node.req);
    return uploadAgentSessionAttachment(sessionId, file);
}));

/** 使用 busboy 限制 part 数、字段数和真实文件流大小。 */
async function readSingleImage(request: IncomingMessage): Promise<UploadedFile> {
    return new Promise<UploadedFile>((resolve, reject) => {
        let parser: ReturnType<typeof Busboy>;
        try {
            parser = Busboy({
                headers: request.headers,
                limits: {
                    files: 1,
                    fields: 0,
                    // Busboy 的 partsLimit 在“达到”上限时触发；设为 2 才能让唯一合法 part 通过，
                    // 同时可靠探测并拒绝第二个 part。公开合同仍严格只接受一个 file。
                    parts: 2,
                    // fileSize 的 limit 事件同样在“达到”阈值时触发。多放行 1 byte 作为溢出哨兵，
                    // finish 仍按 `> maxImageBytes` 拒绝，确保精确 16 MiB 合法且 16 MiB + 1 失败。
                    fileSize: AGENT_IMAGE_POLICY.maxImageBytes + 1,
                },
            });
        } catch {
            reject(invalidMultipartError());
            return;
        }

        let fileSeen = false;
        let invalid = false;
        let limitExceeded = false;
        let fileName = "";
        let mimeType = "";
        let size = 0;
        const chunks: Buffer[] = [];

        parser.on("file", (fieldName, stream, info) => {
            if (fileSeen || fieldName !== "file" || !info.filename) {
                invalid = true;
                stream.resume();
                return;
            }
            fileSeen = true;
            fileName = info.filename;
            mimeType = info.mimeType;
            stream.on("limit", () => {
                limitExceeded = true;
            });
            stream.on("data", (chunk: Buffer) => {
                size += chunk.byteLength;
                if (size <= AGENT_IMAGE_POLICY.maxImageBytes) {
                    chunks.push(chunk);
                }
            });
            stream.on("error", reject);
        });
        parser.on("field", () => {
            invalid = true;
        });
        parser.on("filesLimit", () => {
            invalid = true;
        });
        parser.on("fieldsLimit", () => {
            invalid = true;
        });
        parser.on("partsLimit", () => {
            invalid = true;
        });
        parser.on("error", () => reject(invalidMultipartError()));
        parser.on("finish", () => {
            if (limitExceeded || size > AGENT_IMAGE_POLICY.maxImageBytes) {
                reject(imageLimitError());
                return;
            }
            if (invalid || !fileSeen || size === 0 || !fileName) {
                reject(invalidMultipartError());
                return;
            }
            resolve({
                bytes: Buffer.concat(chunks, size),
                ...(mimeType ? {mimeType} : {}),
                name: fileName,
            });
        });
        request.once("aborted", () => reject(createError({statusCode: 400, message: "上传请求已中止"})));
        request.pipe(parser);
    });
}

function invalidMultipartError(): Error {
    return createError({
        statusCode: 400,
        message: "multipart 必须且只能包含一个 file",
        data: {code: "INVALID_ATTACHMENT_MULTIPART"},
    });
}

function imageLimitError(): Error {
    return createError({
        statusCode: 413,
        message: "单张图片超过允许大小",
        data: {code: "AGENT_IMAGE_LIMIT_EXCEEDED"},
    });
}
