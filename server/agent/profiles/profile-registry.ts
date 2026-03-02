import type {AgentThreadKind, ProfileKey} from "nbook/server/agent/types";
import type {AgentProfile} from "nbook/server/agent/profiles/agent-profile";

/**
 * profile 注册表接口。
 */
export interface AgentProfileRegistry {
    get<TKey extends ProfileKey>(profileKey: TKey): AgentProfile<TKey>;
    list(): AgentProfile<ProfileKey>[];
    listByKind(kind: AgentThreadKind): AgentProfile<ProfileKey>[];
    register<TKey extends ProfileKey>(profile: AgentProfile<TKey>): void;
}

/**
 * 内存版 profile 注册表。
 */
export class InMemoryAgentProfileRegistry implements AgentProfileRegistry {
    private readonly profiles = new Map<ProfileKey, AgentProfile<ProfileKey>>();

    get<TKey extends ProfileKey>(profileKey: TKey): AgentProfile<TKey> {
        const profile = this.profiles.get(profileKey);
        if (!profile) {
            throw new Error(`未注册的 profileKey: ${profileKey}`);
        }
        return profile as AgentProfile<TKey>;
    }

    list(): AgentProfile<ProfileKey>[] {
        return [...this.profiles.values()];
    }

    listByKind(kind: AgentThreadKind): AgentProfile<ProfileKey>[] {
        return this.list().filter((profile) => profile.kind === kind);
    }

    register<TKey extends ProfileKey>(profile: AgentProfile<TKey>): void {
        this.profiles.set(profile.key, profile as AgentProfile<ProfileKey>);
    }
}
