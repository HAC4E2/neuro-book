import {describe, expect, test} from "bun:test";
import {parsePeek, peekValue, taskPeekHref, type Peek} from "../src/web/host/peek.js";

/** Task 页速览面板的网址状态（t15 阶段 4 第 2 批）。 */
describe("?peek= 的写法", () => {
    test("三种都能来回：写进网址再读回来是同一个", () => {
        const peeks: Peek[] = [{kind: "artifact", artifactId: "uxq"}, {kind: "doc", checkout: "w00022-dev-panel", path: "docs/specs/README.md"}, {kind: "evidence", path: ".agents/works/w1/tasks/t1/evidences/a.txt"}];
        expect(peeks.map((peek) => parsePeek(peekValue(peek)))).toEqual(peeks);
        expect(taskPeekHref("w1", "t1", peeks[1]!)).toBe("/work/w1/task/t1?peek=doc%2Fw00022-dev-panel%2Fdocs%2Fspecs%2FREADME.md");
    });

    test("读不懂的值当作没开：未知种类、缺段、绝对路径、..", () => {
        expect(["", "artifact", "artifact/a/b", "doc/main", "doc//x.md", "evidence//etc/passwd", "evidence/a/../../b", "page/x", null, 3].map(parsePeek)).toEqual(Array(10).fill(null));
    });
});
