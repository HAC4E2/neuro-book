import YAML, {isScalar, visit} from "yaml";
import {createTextToImageFileHash} from "nbook/shared/text-to-image-file-hash";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u;

export type StrictFrontmatterDocument = {
    /** YAML 是外部文件边界；调用方必须立即交给自己的 strict schema 收窄。 */
    frontmatter: unknown;
    body: string;
};

/** 解析并拒绝 Storyboard 域禁止的 YAML 执行特性。 */
export function parseStrictTextToImageFrontmatter(markdown: string, label: string): StrictFrontmatterDocument {
    const matched = FRONTMATTER_PATTERN.exec(markdown);
    if (!matched) {
        throw new Error(`${label} Markdown 缺少规范 frontmatter`);
    }
    const document = YAML.parseDocument(matched[1] ?? "", {
        logLevel: "silent",
        strict: true,
        uniqueKeys: true,
        merge: false,
        customTags: [],
    });
    if (document.errors.length > 0) {
        throw new Error(`${label} frontmatter 解析失败：${document.errors.map((error) => error.message).join("; ")}`);
    }
    if (document.warnings.length > 0) {
        throw new Error(`${label} frontmatter 包含不允许的 YAML 警告：${document.warnings.map((warning) => warning.message).join("; ")}`);
    }
    let structuralError = "";
    visit(document, {
        Alias() {
            structuralError = `${label} frontmatter 禁止 YAML alias`;
            return visit.BREAK;
        },
        Node(_key, node) {
            if ("anchor" in node && node.anchor) {
                structuralError = `${label} frontmatter 禁止 YAML anchor`;
                return visit.BREAK;
            }
            // canonical renderer 不产生显式 tag；所有显式 tag 都拒绝，避免伪造标准命名空间绕过。
            if (node.tag) {
                structuralError = `${label} frontmatter 禁止显式 YAML tag`;
                return visit.BREAK;
            }
        },
        Pair(_key, pair) {
            if (isScalar(pair.key) && pair.key.value === "<<") {
                structuralError = `${label} frontmatter 禁止 YAML merge key`;
                return visit.BREAK;
            }
        },
    });
    if (structuralError) {
        throw new Error(structuralError);
    }
    return {
        frontmatter: document.toJS(),
        body: matched[2] ?? "",
    };
}

/** 以固定 YAML 参数渲染 strict frontmatter 和人类说明正文。 */
export function renderStrictTextToImageFrontmatter(frontmatter: object, body: string): string {
    const yaml = YAML.stringify(frontmatter, {lineWidth: 0});
    const normalizedBody = body.replace(/\r\n?/gu, "\n");
    return `---\n${yaml}---\n${normalizedBody}${normalizedBody.endsWith("\n") ? "" : "\n"}`;
}

/** 完整 Markdown UTF-8 字节 hash，只用于文件编辑冲突。 */
export function createTextToImageMarkdownFileHash(markdown: string): string {
    return createTextToImageFileHash(markdown);
}
