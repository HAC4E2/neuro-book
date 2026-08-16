import path from "node:path";

/** 已规范化的文件系统绝对路径品牌；与应用运行时路径类型保持结构兼容。 */
export type AbsoluteFsPath = string & {readonly __absoluteFsPath: "absolute-fs-path"};

/** 为测试建立宿主原生绝对路径，不把仓库根当作运行数据根。 */
export function testHostPath(...segments: string[]): string {
    return path.resolve(process.cwd(), ".agent", "tmp", "test-paths", ...segments);
}

/** 返回带有绝对文件系统品牌的测试路径。 */
export function testAbsoluteFsPath(...segments: string[]): AbsoluteFsPath {
    return testHostPath(...segments) as AbsoluteFsPath;
}
