/**
 * 行的图标（docs/specs/workbench/files-explorer.md 的“行的样子”）：文件按扩展名，目录按文件夹类型与少数常见名字。纯函数，
 * 只看名字与列出结果，不读内容。图标本身在生成的 `catppuccin.ts` 里；这里用到的名字都要在生成脚本的清单里。
 */

import type {FolderKind} from "nbook/plugins/files/shared/contracts";

import type {CatppuccinIcon} from "./catppuccin";

export interface IconSubject {
    /** 目录项的类型；符号链接、其它类型与缺失条目都按普通文件画。 */
    readonly kind: "file" | "directory" | "link" | "other" | "missing";
    readonly name: string;
    /** 目录的文件夹类型；文件为 `null`。 */
    readonly folder: FolderKind | null;
    readonly expanded: boolean;
    /** 内容文件夹里的目录：节点。 */
    readonly node: boolean;
    /** 节点有正文。 */
    readonly body: boolean;
}

const BY_EXTENSION: Readonly<Record<string, CatppuccinIcon>> = {
    md: "markdown", markdown: "markdown", mdx: "markdown",
    txt: "text", text: "text",
    json: "json", jsonc: "json", json5: "json",
    yaml: "yaml", yml: "yaml", toml: "toml", xml: "xml", csv: "csv", tsv: "csv", pdf: "pdf",
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", avif: "image", ico: "image", svg: "svg",
    mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio", aac: "audio",
    mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video",
    ttf: "font", otf: "font", woff: "font", woff2: "font",
    zip: "zip", "7z": "zip", rar: "zip", tar: "zip", gz: "zip", tgz: "zip", bz2: "zip", xz: "zip",
    db: "database", sqlite: "database", sqlite3: "database",
    html: "html", htm: "html", css: "css", scss: "css", less: "css",
    js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
    ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript",
};

type FolderIcon = "folder" | "folder-images" | "folder-docs" | "folder-audio" | "folder-video" | "folder-fonts" | "folder-config";

/** 普通文件夹按名字（不区分大小写）认出的几类；写作项目里常见的中文名也算。 */
const BY_FOLDER_NAME: Readonly<Record<string, FolderIcon>> = {
    images: "folder-images", image: "folder-images", img: "folder-images", pictures: "folder-images", 图片: "folder-images", 插图: "folder-images", 配图: "folder-images",
    docs: "folder-docs", doc: "folder-docs", 资料: "folder-docs", 文档: "folder-docs", 参考: "folder-docs",
    audio: "folder-audio", music: "folder-audio", 音频: "folder-audio", 音乐: "folder-audio",
    video: "folder-video", videos: "folder-video", 视频: "folder-video",
    fonts: "folder-fonts", 字体: "folder-fonts",
    config: "folder-config", 配置: "folder-config",
};

export function fileIconOf(subject: IconSubject): CatppuccinIcon {
    if (subject.kind === "directory") {
        if (subject.node) return subject.body ? "markdown" : subject.expanded ? "folder-content-open" : "folder-content";
        const base: FolderIcon | "folder-content" = subject.folder === "content" ? "folder-content" : subject.folder === "binder" ? "folder-docs" : BY_FOLDER_NAME[subject.name.toLowerCase()] ?? "folder";
        return subject.expanded ? `${base}-open` : base;
    }
    const dot = subject.name.lastIndexOf(".");
    if (dot <= 0) return "file";
    return BY_EXTENSION[subject.name.slice(dot + 1).toLowerCase()] ?? "file";
}
