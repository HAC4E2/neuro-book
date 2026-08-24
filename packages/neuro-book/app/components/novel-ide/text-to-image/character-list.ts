export type CharacterListItemIdentity = {
    characterId: string;
    groupId: string | null;
};

export function characterListItemKey(item: CharacterListItemIdentity): string {
    return `${item.groupId ?? "legacy"}:${item.characterId}`;
}

export function filterCharacterList<T extends CharacterListItemIdentity>(
    items: readonly T[],
    groupFilter: "all" | string,
): T[] {
    if (groupFilter === "all") {
        return [...items];
    }
    if (groupFilter === "__legacy__") {
        return items.filter((item) => item.groupId === null);
    }
    return items.filter((item) => item.groupId === groupFilter);
}
