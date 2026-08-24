import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {describe, expect, it} from "vitest";
import FormCheckbox from "./FormCheckbox.vue";
import FormInput from "./FormInput.vue";
import FormNumberInput from "./FormNumberInput.vue";
import FormSelect from "./FormSelect.vue";

describe("phase 2 form control contracts", () => {
    it("keeps FormInput numeric attributes, prefix slot and focus event", async () => {
        const wrapper = mount(FormInput, {
            props: {
                modelValue: "12",
                type: "number",
                min: "0",
                max: "20",
                step: "0.5",
            },
            slots: {prefix: "<span data-prefix>¥</span>"},
        });
        const input = wrapper.get("input");
        expect(wrapper.get("[data-prefix]").text()).toBe("¥");
        expect(input.attributes("min")).toBe("0");
        expect(input.attributes("max")).toBe("20");
        expect(input.attributes("step")).toBe("0.5");
        await input.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
    });

    it("preserves FormNumberInput editing states and applies bounded stepping", async () => {
        const wrapper = mount(FormNumberInput, {
            props: {modelValue: "-", min: "0", max: "2", step: "0.5"},
        });
        const input = wrapper.get("input");
        await input.setValue("1.");
        expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["1."]);

        await wrapper.setProps({modelValue: "1.5"});
        await wrapper.get("button[aria-label='增加']").trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2"]);

        await wrapper.setProps({modelValue: "2"});
        await wrapper.get("button[aria-label='增加']").trigger("click");
        expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2"]);

        await input.trigger("keydown", {key: "Enter"});
        expect(wrapper.emitted("submit")).toHaveLength(1);
    });

    it("renders FormSelect placeholder, rich options and compact direction contract", async () => {
        const wrapper = mount(FormSelect, {
            props: {
                modelValue: "",
                placeholder: "选择格式",
                size: "sm",
                dropdownDirection: "up",
                options: [
                    {label: "Markdown", value: "md", description: "纯文本标记", iconClass: "i-lucide-file-text"},
                    {label: "PDF", value: "pdf", description: "暂不可用", disabled: true, indicatorClass: "bg-red-500"},
                ],
            },
            attachTo: document.body,
        });
        const trigger = wrapper.get("[role='combobox']");
        expect(trigger.text()).toContain("选择格式");
        expect(trigger.classes()).toContain("nb-ui-control-h-sm");
        await trigger.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
        await trigger.trigger("keydown", {key: "Enter"});
        await nextTick();
        await nextTick();

        expect(document.body.textContent).toContain("纯文本标记");
        expect(document.body.textContent).toContain("暂不可用");
        expect(document.querySelector("[role='listbox']")?.getAttribute("data-side")).toBe("top");
        wrapper.unmount();
    });

    it("gives FormCheckbox an optional label fallback and forwards focus", async () => {
        const wrapper = mount(FormCheckbox, {props: {modelValue: false}});
        const input = wrapper.get("input");

        expect(wrapper.text()).toContain("false");
        await wrapper.setProps({modelValue: true});
        expect(wrapper.text()).toContain("true");
        await input.trigger("focus");
        expect(wrapper.emitted("focus")).toHaveLength(1);
    });
});
