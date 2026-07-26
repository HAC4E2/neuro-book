import {describe, expect, it} from "vitest";

import {findNodeModuleSpecifiers} from "./assert-client-runtime-boundary";

describe("client runtime boundary", () => {
    it("finds Node built-ins only when they are module specifiers", () => {
        const source = [
            "import \"node:crypto\";",
            "import {readFile} from \"node:fs\";",
            "export {join} from \"node:path\";",
            "const os = import(\"node:os\");",
            "import \"./browser-module.js\";",
            "const label = \"node:not-a-module\";",
        ].join("\n");

        expect(findNodeModuleSpecifiers(source)).toEqual([
            "node:crypto",
            "node:fs",
            "node:path",
            "node:os",
        ]);
    });
});
