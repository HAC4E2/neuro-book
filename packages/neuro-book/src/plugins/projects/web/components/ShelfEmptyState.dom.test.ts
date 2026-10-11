/** ShelfEmptyState（同名 .md）：说清新作品建在哪（或还没设），两个入口各发自己的事件。 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import ShelfEmptyState from "./ShelfEmptyState.vue";

const mounted: Array<{unmount(): void}> = [];
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function open(library: string | null) {
    const wrapper = mount(ShelfEmptyState, {props: {locale: "zh-CN" as const, library}, attachTo: document.body});
    mounted.push(wrapper);
    return wrapper;
}

describe("ShelfEmptyState", () => {
    it("设了作品目录时写新作品会放在哪；两个按钮各发 create 与 add-existing", async () => {
        const wrapper = open("/home/writer/Documents/NeuroBook");
        expect(wrapper.text()).toContain("新建的作品会放在 /home/writer/Documents/NeuroBook");
        await wrapper.get("[data-shelf-empty-create]").trigger("click");
        await wrapper.get("[data-shelf-empty-add]").trigger("click");
        expect(wrapper.emitted("create")).toHaveLength(1);
        expect(wrapper.emitted("add-existing")).toHaveLength(1);
    });

    it("还没设作品目录时说第一次新建会问", () => {
        const wrapper = open(null);
        expect(wrapper.text()).toContain("第一次新建时会问一次作品放在哪");
        expect(wrapper.text()).not.toContain("会放在");
    });
});
