import {loadEffectiveConfig} from "nbook/server/config/config-service";
import {CharacterVisualMigrationService} from "nbook/server/text-to-image/character-visual-migration.service";
import {TagIndexReader} from "nbook/server/text-to-image/tag-index/tag-index-reader";
import {TagIndexStore} from "nbook/server/text-to-image/tag-index/tag-index-store";
import {TagPolicyRegistryService} from "nbook/server/text-to-image/tag-index/tag-policy-registry";
import {TagResolverService} from "nbook/server/text-to-image/tag-index/tag-resolver.service";
import {TAG_INDEX_CAPABILITY_VERSION} from "nbook/shared/text-to-image-tag-index";

/**
 * 为一次 HTTP 请求创建 Project-bound migration service。
 *
 * Project policy 从 Config 真相源冻结；Resolver 只读 active Workspace Root Tag index。
 */
export async function createCharacterVisualMigrationService(projectPath: string): Promise<CharacterVisualMigrationService> {
    const effective = await loadEffectiveConfig({workspaceKind: "novel", projectPath});
    const indexStore = new TagIndexStore();
    const resolver = new TagResolverService({
        reader: new TagIndexReader({root: indexStore.root}),
        policyRegistry: new TagPolicyRegistryService(),
        capabilityVersion: TAG_INDEX_CAPABILITY_VERSION,
        resolveProjectPolicy: async () => effective.illustration.tagPolicy,
    });
    return new CharacterVisualMigrationService({resolver});
}
