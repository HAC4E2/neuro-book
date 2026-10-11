/** focus-rules（Lab 光晕检查）：从选择器里认出聚焦时会画环的元素，以及环是不是画在被选元素自己身上。 */
import {describe, expect, it} from "bun:test";

import {ringSelectors} from "./focus-rules";

describe("ringSelectors", () => {
    it("焦点伪类直接写在被选元素上为 direct；同一条规则里不含焦点伪类的分支不算", () => {
        expect(ringSelectors("button:hover, .frame:focus-visible")).toEqual([{selector: ".frame:is(*)", direct: true}]);
        expect(ringSelectors(".row:focus")).toEqual([{selector: ".row:is(*)", direct: true}]);
        expect(ringSelectors(":is(.list) .item:focus-visible")).toEqual([{selector: ":is(.list) .item:is(*)", direct: true}]);
    });

    it("环画在外框上的（:focus-within、:has(... :focus-visible)、焦点在祖先上）不是 direct", () => {
        expect(ringSelectors(".field:focus-within")).toEqual([{selector: ".field:is(*)", direct: false}]);
        expect(ringSelectors(".box:has(> [role=\"listbox\"]:focus-visible)")).toEqual([{selector: ".box:has(> [role=\"listbox\"]:is(*))", direct: false}]);
        expect(ringSelectors(".card:focus-visible .badge")).toEqual([{selector: ".card:is(*) .badge", direct: false}]);
    });

    it("类名里转义的冒号不是伪类；括号与方括号里的逗号不切分支", () => {
        expect(ringSelectors(".focus-visible\\:ring:focus-visible")).toEqual([{selector: ".focus-visible\\:ring:is(*)", direct: true}]);
        expect(ringSelectors(".focus-visible\\:ring")).toEqual([]);
        expect(ringSelectors(":is(.a, .b):focus-visible, [data-x=\"1,2\"]")).toEqual([{selector: ":is(.a, .b):is(*)", direct: true}]);
    });
});
