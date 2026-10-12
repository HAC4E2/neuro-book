import {expect, test} from "bun:test";
import * as devPanel from "@notnotype/dev-panel";

test("包入口可导入，编号格式可用", () => {
    expect(devPanel.formatTaskId(100, "smoke")).toBe("t100-smoke");
    expect(devPanel.parseWorkId("w00001-smoke")?.number).toBe(1);
});
