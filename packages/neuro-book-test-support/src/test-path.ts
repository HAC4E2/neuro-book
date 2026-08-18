import path from "node:path";
import {resolveAgentTempRoot} from "./paths";

/** 已规范化的文件系统绝对路径品牌；与应用运行时路径类型保持结构兼容。 */
export type AbsoluteFsPath = string & {readonly __absoluteFsPath: "absolute-fs-path"};

/** 为测试建立宿主原生绝对路径，统一落在受控系统临时根。 */
export function testHostPath(...segments: string[]): string {
    return path.resolve(resolveAgentTempRoot(), "test-paths", ...segments);
}

/** 返回带有绝对文件系统品牌的测试路径。 */
export function testAbsoluteFsPath(...segments: string[]): AbsoluteFsPath {
    return testHostPath(...segments) as AbsoluteFsPath;
}
