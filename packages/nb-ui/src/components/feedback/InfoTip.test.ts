/** InfoTip（同名 .md）：按钮带可访问名称、attrs 落在按钮上；键盘聚焦立即显示说明。 */
import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick} from "vue";

import InfoTip from "./InfoTip.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

describe("InfoTip", () => {
    it("按钮带可访问名称（缺省“说明”），attrs 落在按钮上；聚焦时立即显示说明", async () => {
        const wrapper = mount(InfoTip, {props: {text: "目录不存在会一并创建"}, attrs: {"data-probe": ""}, attachTo: document.body});
        mounted.push(wrapper);
        const button = wrapper.get("button[data-probe]");
        expect(button.attributes("aria-label")).toBe("说明");
        expect(button.attributes("type")).toBe("button");
        expect(document.body.textContent).not.toContain("目录不存在会一并创建");
        await button.trigger("focus");
        await nextTick();
        await nextTick();
        expect(document.body.textContent).toContain("目录不存在会一并创建");

        const named = mount(InfoTip, {props: {text: "x", label: "主题色说明"}, attachTo: document.body});
        mounted.push(named);
        expect(named.get("button").attributes("aria-label")).toBe("主题色说明");
    });
});
