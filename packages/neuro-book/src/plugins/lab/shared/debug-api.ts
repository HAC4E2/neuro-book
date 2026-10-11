/**
 * Lab 调试接口 `window.__nbLab` 的形状：Lab 页面提供它，截图脚本（`scripts/lab-shot.ts`）与 e2e 在浏览器外读它。
 * 只有类型，不依赖 DOM。
 */

export type LabDebugState = {
    component: string;
    scene: string;
    /** fixture 已加载并挂上舞台；截图前等它为 true。 */
    ready: boolean;
    /** fixture 加载失败的原因；没有失败时为空串。 */
    loadError: string;
    canvas: {width: number; height: number};
    themeId: string;
    colorwayId: string;
};

export type LabOverflowOffender = {
    /** 元素检查器同款选择器路径。 */
    selector: string;
    componentName: string;
    /** 越出舞台左右边缘的像素，取较大的一侧。 */
    overflow: number;
};

/** 聚焦光晕会被裁的控件：它离某个裁切祖先的边比光晕外扩量近。 */
export type LabClippedFocus = {
    selector: string;
    componentName: string;
    /** 裁切它的祖先。 */
    clipper: string;
    /** 离最近那条边的距离（像素），小于光晕外扩量。 */
    gap: number;
};

export type LabStageMeasure = {
    /** 舞台在视口中的位置与大小，截图按它裁剪。 */
    box: {x: number; y: number; width: number; height: number};
    /** 舞台内容比舞台宽出的像素；0 表示没有横向溢出。 */
    overflowX: number;
    /** 越出舞台左右边缘、且没有被某个滚动或裁剪容器挡住的元素，最多 20 个。 */
    offenders: LabOverflowOffender[];
    /** 聚焦时光晕会被祖先裁掉一截的可聚焦控件，最多 20 个；按主题的 `--focus-ring` 算外扩量。 */
    clippedFocus: LabClippedFocus[];
};

export type LabDebugApi = {
    version: 1;
    state: () => LabDebugState;
    /** 登记了场景、且可以挂载的组件名，按组件树的顺序。 */
    components: () => string[];
    /** 某个组件（缺省为当前组件）登记的场景。 */
    scenes: (component?: string) => Array<{id: string; label: string}>;
    /** 没有舞台（组件不可挂载或还在加载）时为 null。 */
    measure: () => LabStageMeasure | null;
};
