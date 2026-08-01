import type {IncomingMessage} from "node:http";
import {PassThrough, Readable} from "node:stream";
import {describe, expect, it} from "vitest";
import {
    BoundedFileMultipartError,
    readBoundedFileMultipart,
} from "nbook/server/utils/bounded-file-multipart";

describe("有界单文件 multipart 解析", () => {
    it("按真实 chunk 边界保留二进制文件、名称与 MIME", async () => {
        const boundary = "nbook-bounded-success";
        const bytes = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47]);
        const body = multipartBody(boundary, [{
            name: "file",
            filename: "cover.png",
            mimeType: "image/png",
            data: bytes,
        }]);
        const request = incomingRequest([
            body.subarray(0, 5),
            body.subarray(5, 37),
            body.subarray(37),
        ], boundary);

        await expect(readBoundedFileMultipart(request, {maxFileBytes: 64})).resolves.toEqual({
            bytes,
            mimeType: "image/png",
            name: "cover.png",
        });
    });

    it("允许文件大小精确等于上限", async () => {
        const boundary = "nbook-bounded-exact";
        const bytes = Buffer.alloc(32, 1);
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "exact.bin",
            data: bytes,
        }])], boundary);

        await expect(readBoundedFileMultipart(request, {maxFileBytes: 32})).resolves.toMatchObject({bytes});
    });

    it("在真实流超过上限时返回稳定的 413 错误", async () => {
        const boundary = "nbook-bounded-overflow";
        const request = incomingRequest([multipartBody(boundary, [{
            name: "file",
            filename: "large.bin",
            data: Buffer.alloc(33, 1),
        }])], boundary);

        await expect(readBoundedFileMultipart(request, {maxFileBytes: 32})).rejects.toMatchObject({
            code: "FILE_MULTIPART_LIMIT_EXCEEDED",
            statusCode: 413,
        });
    });

    it("拒绝字段、第二文件、缺失文件与空文件", async () => {
        const cases: MultipartPart[][] = [
            [{name: "note", data: Buffer.from("field")}],
            [
                {name: "file", filename: "one.bin", data: Buffer.from("one")},
                {name: "second", filename: "two.bin", data: Buffer.from("two")},
            ],
            [],
            [{name: "file", filename: "empty.bin", data: Buffer.alloc(0)}],
        ];

        for (const [index, parts] of cases.entries()) {
            const boundary = `nbook-bounded-invalid-${index}`;
            const request = incomingRequest([multipartBody(boundary, parts)], boundary);
            await expect(readBoundedFileMultipart(request, {maxFileBytes: 64})).rejects.toMatchObject({
                code: "INVALID_FILE_MULTIPART",
                statusCode: 400,
            });
        }
    });

    it("拒绝中止的上传且不会等待 finish", async () => {
        const boundary = "nbook-bounded-aborted";
        const request = Object.assign(new PassThrough(), {
            headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
        }) as IncomingMessage;
        const body = multipartBody(boundary, [{
            name: "file",
            filename: "partial.bin",
            data: Buffer.alloc(64, 1),
        }]);

        const parsing = readBoundedFileMultipart(request, {maxFileBytes: 128});
        request.write(body.subarray(0, body.byteLength - 8));
        request.emit("aborted");

        await expect(parsing).rejects.toMatchObject({
            code: "FILE_MULTIPART_ABORTED",
            statusCode: 400,
        });
    });

    it("把缺失 boundary 或错误 Content-Type 归一为 typed error", async () => {
        for (const contentType of ["multipart/form-data", "text/plain"]) {
            const request = Object.assign(Readable.from([]), {
                headers: {"content-type": contentType},
            }) as IncomingMessage;
            await expect(readBoundedFileMultipart(request, {maxFileBytes: 64})).rejects.toBeInstanceOf(
                BoundedFileMultipartError,
            );
        }
    });
});

function incomingRequest(chunks: Buffer[], boundary: string): IncomingMessage {
    return Object.assign(Readable.from(chunks), {
        headers: {"content-type": `multipart/form-data; boundary=${boundary}`},
    }) as IncomingMessage;
}

type MultipartPart = {
    name: string;
    filename?: string;
    mimeType?: string;
    data: Buffer;
};

function multipartBody(boundary: string, parts: MultipartPart[]): Buffer {
    const chunks: Buffer[] = [];
    for (const part of parts) {
        const disposition = part.filename
            ? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`
            : `Content-Disposition: form-data; name="${part.name}"\r\n`;
        chunks.push(Buffer.from(
            `--${boundary}\r\n${disposition}${part.mimeType ? `Content-Type: ${part.mimeType}\r\n` : ""}\r\n`,
            "utf8",
        ));
        chunks.push(part.data, Buffer.from("\r\n", "utf8"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
    return Buffer.concat(chunks);
}
