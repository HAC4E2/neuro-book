export type MarkdownStudioToolState = {
    projectSurfaceActive: boolean;
    userAssetsWorkspace: boolean;
    agentMode: boolean;
    editorKind: "markdown" | "monaco" | "readonly";
    currentMarkdownFile: boolean;
    currentFileEditable: boolean;
    currentContentNode: boolean;
    currentEntryType: string | null | undefined;
    currentFilePath: string;
};

export type CharacterTagToolState = MarkdownStudioToolState & {
    frontmatterProfileKind: "character" | "location" | "rule" | null;
};

function normalizeWorkspacePath(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
    return normalized.startsWith("workspace/") ? normalized.slice("workspace/".length) : normalized;
}

function isCharacterDetailPath(path: string): boolean {
    const normalized = normalizeWorkspacePath(path);
    const segments = normalized.split("/").filter(Boolean);
    return segments[0] === "lorebook"
        && segments[1] === "character"
        && (segments.length === 4 || segments.length === 5)
        && segments.at(-1)?.toLowerCase() === "index.md";
}

function isEditableMarkdown(state: MarkdownStudioToolState): boolean {
    return state.projectSurfaceActive
        && !state.userAssetsWorkspace
        && !state.agentMode
        && state.editorKind === "markdown"
        && state.currentMarkdownFile
        && state.currentFileEditable
        && state.currentContentNode;
}

export function isBodyTextToImageEnabled(state: MarkdownStudioToolState): boolean {
    return isEditableMarkdown(state) && state.currentEntryType === "chapter";
}

export function isCharacterTagGenerateEnabled(state: CharacterTagToolState): boolean {
    return isEditableMarkdown(state)
        && state.currentEntryType === "character"
        && isCharacterDetailPath(state.currentFilePath)
        && state.frontmatterProfileKind === "character"
}
