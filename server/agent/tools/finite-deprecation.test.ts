import {describe, expect, it} from "vitest";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {join} from "node:path";

const SHARED_DIR = join(import.meta.dirname, "..", "..", "..", "shared");
const SERVER_DIR = join(import.meta.dirname, "..", "..", "..", "server");

function walkTsFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = readdirSync(dir);

    for (const entry of entries) {
        const full = join(dir, entry);
        if (entry === "node_modules" || entry === ".nuxt" || entry === "dist") continue;
        try {
            const stat = statSync(full);
            if (stat.isDirectory()) {
                results.push(...walkTsFiles(full));
            } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
                results.push(full);
            }
        } catch {
            // skip entries we can't stat
        }
    }

    return results;
}

describe(".finite() deprecation", () => {
    it("no .finite( calls remain in server/ or shared/ TypeScript source files", () => {
        const serverFiles = walkTsFiles(SERVER_DIR);
        const sharedFiles = walkTsFiles(SHARED_DIR);
        const allFiles = [...serverFiles, ...sharedFiles];

        const violations: string[] = [];

        for (const file of allFiles) {
            // Skip the test file itself
            if (file.includes("finite-deprecation.test.ts")) continue;

            const content = readFileSync(file, "utf-8");
            if (content.includes(".finite(")) {
                violations.push(file);
            }
        }

        expect(
            violations,
            `.finite() calls found in:\n${violations.join("\n")}`,
        ).toEqual([]);
    });
});
