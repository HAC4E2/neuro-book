import {describe, expect, test} from "bun:test";
import {emptyExpansion, toggleExpansion} from "../src/web/host/task-expand.js";

/** Work 页就地展开 Task：同时最多 3 行（决定点 9）。 */
describe("就地展开", () => {
    test("依次展开 4 行：第 4 行占用最早那行的槽，其余两行的槽不动；再点一次收起、空出槽", () => {
        let state = emptyExpansion();
        for (const id of ["t1", "t2", "t3"]) state = toggleExpansion(state, id);
        expect(state).toEqual({slots: ["t1", "t2", "t3"], order: ["t1", "t2", "t3"]});
        state = toggleExpansion(state, "t4");
        expect(state).toEqual({slots: ["t4", "t2", "t3"], order: ["t2", "t3", "t4"]});
        state = toggleExpansion(state, "t3");
        expect(state).toEqual({slots: ["t4", "t2", null], order: ["t2", "t4"]});
        state = toggleExpansion(state, "t1");
        expect(state).toEqual({slots: ["t4", "t2", "t1"], order: ["t2", "t4", "t1"]});
    });
});
