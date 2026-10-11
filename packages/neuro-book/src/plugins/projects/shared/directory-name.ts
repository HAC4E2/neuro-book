/**
 * 由书名生成新作品的目录名（docs/specs/runtime/projects.md 输出 14）。服务端建目录时用它；浏览器在新建的结果未知时也用它
 * 算出本次要建的目录，与重新取到的书架核对，所以放在两端共用的 shared。
 */

import {PROJECT_TITLE_MAX_LENGTH} from "./contracts";

/** Windows 保留的设备名（不分大小写，带扩展名也算），作目录名时在 Windows 上建不出来或指向设备。 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/iu;
/** 跨平台不能用在文件名里的字符：`/ \ : * ? " < > |` 与控制字符。 */
const UNSAFE_NAME_CHARACTERS = /[/\\:*?"<>|\p{Cc}]/gu;
const EDGE_SPACES_AND_DOTS = /^[\s.]+|[\s.]+$/gu;
/** 书名生成不出可用的目录名时用它。 */
export const FALLBACK_DIRECTORY_NAME = "作品";

export function projectDirectoryName(title: string): string {
    const replaced = title.replace(UNSAFE_NAME_CHARACTERS, "-").replace(EDGE_SPACES_AND_DOTS, "");
    // 截断可能把空白或句点留到末尾，再去一次。
    const name = Array.from(replaced).slice(0, PROJECT_TITLE_MAX_LENGTH).join("").replace(EDGE_SPACES_AND_DOTS, "");
    return name === "" || name === "." || name === ".." || WINDOWS_RESERVED.test(name) ? FALLBACK_DIRECTORY_NAME : name;
}
