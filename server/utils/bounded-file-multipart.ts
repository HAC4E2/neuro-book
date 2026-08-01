import Busboy from "busboy";
import type {IncomingMessage} from "node:http";

export type BoundedMultipartFile = Readonly<{
    bytes: Uint8Array;
    mimeType?: string;
    name: string;
}>;

export type BoundedFileMultipartErrorCode =
    | "INVALID_FILE_MULTIPART"
    | "FILE_MULTIPART_LIMIT_EXCEEDED"
    | "FILE_MULTIPART_ABORTED";

/** 可被不同上传入口映射成各自 HTTP 契约的 multipart typed error。 */
export class BoundedFileMultipartError extends Error {
    readonly code: BoundedFileMultipartErrorCode;
    readonly statusCode: 400 | 413;

    constructor(code: BoundedFileMultipartErrorCode, message: string, statusCode: 400 | 413) {
        super(message);
        this.name = "BoundedFileMultipartError";
        this.code = code;
        this.statusCode = statusCode;
    }
}

/**
 * 从 IncomingMessage 读取且只读取一个名为 file 的非空文件 part。
 *
 * 文件流只在累计大小未超过 caller 上限时保留 chunk，因此无 Content-Length 时也有硬内存界限。
 */
export async function readBoundedFileMultipart(
    request: IncomingMessage,
    options: {maxFileBytes: number},
): Promise<BoundedMultipartFile> {
    if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes <= 0) {
        throw invalidMultipartError("multipart 文件大小上限不合法");
    }

    return new Promise<BoundedMultipartFile>((resolve, reject) => {
        let parser: ReturnType<typeof Busboy>;
        try {
            parser = Busboy({
                headers: request.headers,
                limits: {
                    files: 1,
                    fields: 0,
                    // Busboy 在“达到” parts 上限时发出 partsLimit；2 可让一个合法 part 正常完成。
                    parts: 2,
                    // 多放行一个字节作为溢出哨兵，精确等于上限仍然合法。
                    fileSize: options.maxFileBytes + 1,
                },
            });
        } catch {
            reject(invalidMultipartError());
            return;
        }

        let settled = false;
        let fileSeen = false;
        let invalid = false;
        let limitExceeded = false;
        let fileName = "";
        let mimeType = "";
        let size = 0;
        const chunks: Buffer[] = [];

        const cleanup = (): void => {
            request.off("aborted", onAborted);
            request.off("error", onRequestError);
        };
        const fail = (error: BoundedFileMultipartError): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error);
        };
        const onAborted = (): void => {
            request.unpipe(parser);
            parser.destroy();
            fail(new BoundedFileMultipartError("FILE_MULTIPART_ABORTED", "上传请求已中止", 400));
        };
        const onRequestError = (): void => {
            fail(invalidMultipartError("multipart 请求流读取失败"));
        };

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
                if (size <= options.maxFileBytes) {
                    chunks.push(chunk);
                }
            });
            stream.on("error", () => fail(invalidMultipartError("multipart 文件流读取失败")));
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
        parser.on("error", () => fail(invalidMultipartError()));
        parser.on("finish", () => {
            if (settled) {
                return;
            }
            if (limitExceeded || size > options.maxFileBytes) {
                fail(new BoundedFileMultipartError(
                    "FILE_MULTIPART_LIMIT_EXCEEDED",
                    "multipart 文件超过允许大小",
                    413,
                ));
                return;
            }
            if (invalid || !fileSeen || size === 0 || !fileName) {
                fail(invalidMultipartError());
                return;
            }
            settled = true;
            cleanup();
            resolve(Object.freeze({
                bytes: Buffer.concat(chunks, size),
                ...(mimeType ? {mimeType} : {}),
                name: fileName,
            }));
        });
        request.once("aborted", onAborted);
        request.once("error", onRequestError);
        request.pipe(parser);
    });
}

function invalidMultipartError(message = "multipart 必须且只能包含一个 file"): BoundedFileMultipartError {
    return new BoundedFileMultipartError("INVALID_FILE_MULTIPART", message, 400);
}
