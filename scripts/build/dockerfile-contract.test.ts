import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import {describe, expect, it} from "vitest";

describe("Docker Product runtime contract", () => {
    it("runner 只消费 Builder 生成的 verified Runtime Image", async () => {
        const [dockerfile, entrypoint, releaseWorkflow, posixVerify] = await Promise.all([
            readFile(resolve("Dockerfile"), "utf8"),
            readFile(resolve("scripts", "deploy", "docker-product-entrypoint.sh"), "utf8"),
            readFile(resolve(".github", "workflows", "release-container.yml"), "utf8"),
            readFile(resolve("scripts", "release", "verify-posix-product.sh"), "utf8"),
        ]);

        expect(dockerfile).toContain("ARG NEURO_BOOK_SOURCE_REVISION");
        expect(dockerfile).toContain("ENV NEURO_BOOK_SOURCE_REVISION=${NEURO_BOOK_SOURCE_REVISION}");
        expect(dockerfile).toContain("RUN bun run nuxt:build");
        expect(dockerfile).toContain("test -f .output/runtime-image.json && test -f .output/runtime-image.ready");
        expect(dockerfile).toContain("COPY --from=build /app/.output ./.output");
        expect(dockerfile).toContain("COPY --from=build /app/scripts/deploy/docker-product-entrypoint.sh ./docker-product-entrypoint.sh");
        expect(dockerfile).toContain('ENTRYPOINT ["sh", "./docker-product-entrypoint.sh"]');
        for (const sourceDirectory of ["/app/app", "/app/server", "/app/shared", "/app/scripts ./scripts", "/app/docs", "/app/assets"]) {
            expect(dockerfile).not.toContain(sourceDirectory);
        }
        expect(dockerfile).not.toContain("prepare-system-assets.ts --force --product-build");
        expect(releaseWorkflow.replaceAll("\r\n", "\n")).toContain([
            "build-args: |",
            "            NEURO_BOOK_SOURCE_REVISION=${{ github.sha }}",
        ].join("\n"));
        expect(entrypoint).toContain(".output/server/commands/product-command.mjs command start");
        expect(entrypoint).not.toContain("command migrate-database");
        expect(entrypoint).not.toContain("command migrate-application-state");
        expect(entrypoint).not.toContain(".output/server/scripts/");
        expect(posixVerify).toContain(".output/server/commands/product-command.mjs command migrate-application-state --apply");
        expect(posixVerify).not.toContain("command migrate-database");
        expect(releaseWorkflow).toContain('"${product_root}/.output/server/commands/product-command.mjs" command migrate-application-state --apply');
        expect(releaseWorkflow).not.toContain("command migrate-database");
    });
});
