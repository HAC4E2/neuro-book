import {describe, expect, it} from "vitest";

import {dragScrollTop, MIN_THUMB_PX, pageScrollTop, thumbGeometry} from "./overlay-scrollbar";

describe("叠加滚动条的几何", () => {
    it("内容不溢出（或只多出不到 1px）时不画滑块", () => {
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 300})).toBeNull();
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 300.6})).toBeNull();
        expect(thumbGeometry({scrollTop: 0, clientHeight: 0, scrollHeight: 500})).toBeNull();
    });

    it("滑块高度按可见比例，位置按滚动比例走完整条轨道", () => {
        expect(thumbGeometry({scrollTop: 0, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 0, size: 150});
        expect(thumbGeometry({scrollTop: 300, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 150, size: 150});
        expect(thumbGeometry({scrollTop: 150, clientHeight: 300, scrollHeight: 600})).toEqual({offset: 75, size: 150});
    });

    it("内容很长时滑块不短于下限，仍能走到轨道底；越界的滚动位置夹回范围内", () => {
        const long = {clientHeight: 300, scrollHeight: 300 * 100};
        expect(thumbGeometry({...long, scrollTop: 0})?.size).toBe(MIN_THUMB_PX);
        expect(thumbGeometry({...long, scrollTop: long.scrollHeight - long.clientHeight})?.offset).toBe(300 - MIN_THUMB_PX);
        expect(thumbGeometry({...long, scrollTop: -40})?.offset).toBe(0);
    });

    it("拖动：滑块走完剩余轨道等于内容滚完，不越过两端", () => {
        const start = {scrollTop: 0, clientHeight: 300, scrollHeight: 600};
        expect(dragScrollTop(start, 75)).toBe(150);
        expect(dragScrollTop(start, 150)).toBe(300);
        expect(dragScrollTop(start, 400)).toBe(300);
        expect(dragScrollTop({...start, scrollTop: 100}, -400)).toBe(0);
        expect(dragScrollTop({scrollTop: 0, clientHeight: 300, scrollHeight: 300}, 50)).toBe(0);
    });

    it("点轨道：滑块上方滚上一页、下方滚下一页、点在滑块上不动，不越界", () => {
        const metrics = {scrollTop: 300, clientHeight: 300, scrollHeight: 1200};
        // 滑块 size 75；滚动 300/900，offset 是剩余轨道 225 的三分之一：75。
        expect(pageScrollTop(metrics, 10)).toBe(0);
        expect(pageScrollTop(metrics, 200)).toBe(600);
        expect(pageScrollTop(metrics, 100)).toBe(300);
        expect(pageScrollTop({...metrics, scrollTop: 800}, 299)).toBe(900);
    });
});
