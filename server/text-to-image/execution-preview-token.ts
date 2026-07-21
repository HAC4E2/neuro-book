import {createHash, createHmac, timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {TextToImageContractHashSchema} from "nbook/shared/text-to-image-tag-resolution";

export const ILLUSTRATION_PREVIEW_TOKEN_VERSION = "nbook.illustration-preview-token/v1" as const;

const PreviewTokenClaimsSchema = z.object({
    schemaVersion: z.literal(ILLUSTRATION_PREVIEW_TOKEN_VERSION),
    executionNonce: z.string().trim().min(1).max(200),
    targetHash: TextToImageContractHashSchema,
    manifestHash: TextToImageContractHashSchema,
    expiresAt: z.number().int().positive().safe(),
}).strict();

export type ExecutionPreviewTokenClaims = z.infer<typeof PreviewTokenClaimsSchema>;

export type ExecutionPreviewTokenErrorCode =
    | "ILLUSTRATION_PREVIEW_TOKEN_INVALID"
    | "ILLUSTRATION_PREVIEW_TOKEN_EXPIRED";

/** Preview token 的稳定验签/TTL 错误；授权入口据此决定刷新而非注册 Job。 */
export class ExecutionPreviewTokenError extends Error {
    constructor(readonly code: ExecutionPreviewTokenErrorCode, message: string) {
        super(`${code}: ${message}`);
        this.name = "ExecutionPreviewTokenError";
    }
}

/** HMAC preview token 服务；claims 不包含 secret、Prompt 或 CompiledRequest。 */
export class ExecutionPreviewTokenService {
    private readonly secret: Buffer;
    private readonly now: () => number;
    private readonly ttlMs: number;

    constructor(options: {secret: string | Uint8Array; now?: () => number; ttlMs?: number}) {
        this.secret = parseSecret(options.secret);
        this.now = options.now ?? Date.now;
        this.ttlMs = z.number().int().min(10_000).max(600_000).parse(options.ttlMs ?? 120_000);
    }

    /** 签发短生命周期 token，并把精确 claims 返回给 preview DTO。 */
    issue(input: Omit<ExecutionPreviewTokenClaims, "schemaVersion" | "expiresAt">): {
        token: string;
        claims: ExecutionPreviewTokenClaims;
    } {
        const issuedAt = z.number().int().nonnegative().safe().parse(this.now());
        const claims = PreviewTokenClaimsSchema.parse({
            schemaVersion: ILLUSTRATION_PREVIEW_TOKEN_VERSION,
            ...input,
            expiresAt: issuedAt + this.ttlMs,
        });
        const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
        return {token: `${encoded}.${this.sign(encoded)}`, claims};
    }

    /** 验证 token 结构、HMAC 与严格 TTL；到期时不提供宽限窗口。 */
    verify(tokenInput: string): ExecutionPreviewTokenClaims {
        const token = z.string().trim().min(1).max(4_096).safeParse(tokenInput);
        if (!token.success) throw invalidToken("token 结构非法");
        const parts = token.data.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalidToken("token 结构非法");
        const [encoded, signature] = parts;
        const expected = Buffer.from(this.sign(encoded), "ascii");
        const actual = Buffer.from(signature, "ascii");
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            throw invalidToken("token 签名不匹配");
        }
        let decoded: unknown;
        try {
            decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
        } catch {
            throw invalidToken("token payload 非法");
        }
        const claims = PreviewTokenClaimsSchema.safeParse(decoded);
        if (!claims.success) throw invalidToken("token claims 非法");
        const now = z.number().int().nonnegative().safe().parse(this.now());
        if (now >= claims.data.expiresAt) {
            throw new ExecutionPreviewTokenError("ILLUSTRATION_PREVIEW_TOKEN_EXPIRED", "Execution Preview 已过期，请刷新");
        }
        return claims.data;
    }

    /** 对 base64url payload 计算固定 SHA-256 HMAC。 */
    private sign(encoded: string): string {
        return createHmac("sha256", this.secret).update(encoded, "ascii").digest("base64url");
    }
}

/**
 * 按冻结规格从 nonce/source/variant/output/compiler 派生 NovelAI uint32 seed。
 * 相同 preview token 重算不会再次调用随机数。
 */
export function deriveIllustrationSeed(input: {
    executionNonce: string;
    sourceIdentityHash: string;
    variantIndex: number;
    outputIndex: number;
    compilerVersion: string;
}): number {
    const parsed = z.object({
        executionNonce: z.string().trim().min(1).max(200),
        sourceIdentityHash: TextToImageContractHashSchema,
        variantIndex: z.number().int().min(0).max(31),
        outputIndex: z.number().int().min(0).max(31),
        compilerVersion: z.string().trim().min(1).max(200),
    }).strict().parse(input);
    const digest = createHash("sha256")
        .update(`${parsed.executionNonce}${parsed.sourceIdentityHash}${String(parsed.variantIndex)}${String(parsed.outputIndex)}${parsed.compilerVersion}`, "utf8")
        .digest();
    return digest.readUInt32BE(0);
}

/** HMAC secret 至少 32 bytes，避免部署误用短口令。 */
function parseSecret(secret: string | Uint8Array): Buffer {
    const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
    if (bytes.byteLength < 32) throw new Error("Execution Preview HMAC secret 至少需要 32 bytes");
    return bytes;
}

/** 构造不泄露内部解析细节的 invalid token 错误。 */
function invalidToken(message: string): ExecutionPreviewTokenError {
    return new ExecutionPreviewTokenError("ILLUSTRATION_PREVIEW_TOKEN_INVALID", message);
}
