<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";
import {useTheme} from "../composables/useTheme";
import {useColorway} from "../composables/useColorway";
import LabInspector, {type LabEventEntry} from "../component-lab/LabInspector.vue";
import LabPreview from "../component-lab/LabPreview.vue";
import LabVariableEditor from "../component-lab/LabVariableEditor.vue";
import {useLabOverrides} from "../component-lab/useLabOverrides";
import {useLabSession} from "../component-lab/useLabSession";
import {
    labComponents,
    labCoreTokenGroups,
    labViewports,
    type LabComponentId,
    type LabTokenGroup,
} from "../component-lab/registry";

const theme = useTheme();
const colorway = useColorway();
const session = useLabSession();
const activeInspectorTab = ref<"variables" | "inspection" | "events">("variables");
const events = ref<LabEventEntry[]>([]);
const eventSequence = ref(0);
const inspectRevision = ref(0);
const statusMessage = ref("");
const statusIsError = ref(false);
const importInput = ref<HTMLInputElement | null>(null);
const resolvedValues = ref<Record<string, string>>({});
const sessionReady = ref(false);
let refreshTimer: number | undefined;

const groupedComponents = computed(() => {
    const groups = new Map<string, typeof labComponents>();
    for (const component of labComponents) {
        const group = groups.get(component.group) ?? [];
        group.push(component);
        groups.set(component.group, group);
    }
    return [...groups.entries()].map(([label, components]) => ({label, components}));
});

const activeDefinition = computed(() => labComponents.find((component) => component.id === session.componentId.value) ?? labComponents[0]!);
const activeViewport = computed(() => labViewports.find((viewport) => viewport.id === session.viewportId.value) ?? labViewports[0]!);
const canvasWidth = computed(() => activeViewport.value.width === null ? "100%" : `${activeViewport.value.width}px`);
function viewportLabel(viewport: (typeof labViewports)[number]): string {
    if (viewport.width === null || viewport.label.endsWith("px")) return viewport.label;
    return `${viewport.label}px`;
}


const declaredTokenGroup = computed<LabTokenGroup>(() => {
    const registered = new Set(labCoreTokenGroups.flatMap((group) => group.tokens));
    const tokens = new Set<string>();
    for (const installed of theme.themes.value) {
        for (const declaration of installed.manifest.declares ?? []) {
            if (!registered.has(declaration.name)) tokens.add(declaration.name);
        }
    }
    return {id: "theme-declared", label: "主题 · 已声明变量", tokens: [...tokens]};
});

const tokenGroups = computed(() => {
    const declared = declaredTokenGroup.value;
    return declared.tokens.length === 0 ? labCoreTokenGroups : [...labCoreTokenGroups, declared];
});
const allowedNames = computed<ReadonlySet<string>>(() => new Set(tokenGroups.value.flatMap((group) => group.tokens)));
const labOverrides = useLabOverrides(allowedNames);

function refreshResolvedValues(): void {
    if (typeof document === "undefined") return;
    const styles = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const group of tokenGroups.value) {
        for (const token of group.tokens) next[token] = styles.getPropertyValue(token).trim();
    }
    resolvedValues.value = next;
    if (activeInspectorTab.value === "inspection") inspectRevision.value += 1;
}

function scheduleRefresh(): void {
    if (typeof window === "undefined") return;
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshResolvedValues, 260);
}

function recordEvent(name: string, payload: unknown): void {
    events.value = [{
        id: ++eventSequence.value,
        time: new Date().toLocaleTimeString("zh-CN", {hour12: false}),
        name,
        payload,
    }, ...events.value].slice(0, 100);
    inspectRevision.value += 1;
}

function clearEvents(): void {
    events.value = [];
}

function selectComponent(id: LabComponentId): void {
    session.componentId.value = id;
    events.value = [];
    statusMessage.value = "";
}

function changeTheme(event: Event): void {
    const id = (event.target as HTMLSelectElement).value || null;
    theme.setTheme(id);
    session.setThemeId(id);
    scheduleRefresh();
}

function changeColorway(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (!colorway.colorwayIds.includes(id)) return;
    colorway.setColorway(id);
    session.setColorwayId(id);
    scheduleRefresh();
}

function updateOverride(name: string, value: string): void {
    try {
        labOverrides.setOverride(name, value);
        statusIsError.value = false;
        statusMessage.value = value.trim() === "" ? `已重置 ${name}` : `已覆盖 ${name}`;
        scheduleRefresh();
    } catch (error) {
        statusIsError.value = true;
        statusMessage.value = error instanceof Error ? error.message : "变量值无效";
    }
}

function resetOverride(name: string): void {
    labOverrides.resetOverride(name);
    statusIsError.value = false;
    statusMessage.value = `已重置 ${name}`;
    scheduleRefresh();
}

function resetAllOverrides(): void {
    labOverrides.resetAll();
    statusIsError.value = false;
    statusMessage.value = "已重置全部变量覆盖";
    scheduleRefresh();
}

function downloadSnapshot(): void {
    const blob = new Blob([labOverrides.exportSnapshot()], {type: "application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "nb-ui-component-lab-overrides.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    statusIsError.value = false;
    statusMessage.value = "变量快照已导出";
}

function openImport(): void {
    importInput.value?.click();
}

async function importSnapshot(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
        const count = labOverrides.importSnapshot(await file.text());
        statusIsError.value = false;
        statusMessage.value = `已导入 ${count} 个变量覆盖`;
        scheduleRefresh();
    } catch (error) {
        statusIsError.value = true;
        statusMessage.value = error instanceof Error ? error.message : "变量快照无效";
    }
}

watch([theme.current, colorway.current], () => {
    if (sessionReady.value) {
        session.setThemeId(theme.current.value);
        session.setColorwayId(colorway.current.value);
    }
    scheduleRefresh();
});
watch([tokenGroups, labOverrides.overrides], scheduleRefresh, {deep: true});

onMounted(async () => {
    await nextTick();
    const requestedTheme = session.themeId.value;
    if (requestedTheme !== null && theme.themes.value.some((installed) => installed.manifest.id === requestedTheme)) theme.setTheme(requestedTheme);
    const requestedColorway = session.colorwayId.value;
    if (requestedColorway !== null && colorway.colorwayIds.includes(requestedColorway)) colorway.setColorway(requestedColorway);
    sessionReady.value = true;
    session.setThemeId(theme.current.value);
    session.setColorwayId(colorway.current.value);
    refreshResolvedValues();
});

onBeforeUnmount(() => {
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
});
</script>

<template>
    <main class="lab-page">
        <aside class="lab-sidebar" aria-label="组件目录">
            <header class="lab-sidebar__header">
                <div>
                    <h1>组件调试</h1>
                    <span>可复现的状态与变量实验</span>
                </div>
                <span class="lab-count">{{ labComponents.length }}</span>
            </header>
            <nav class="lab-component-list">
                <section v-for="group in groupedComponents" :key="group.label">
                    <h2>{{ group.label }}</h2>
                    <button
                        v-for="component in group.components"
                        :key="component.id"
                        type="button"
                        class="lab-component-item"
                        :class="{'is-active': session.componentId.value === component.id}"
                        :aria-current="session.componentId.value === component.id ? 'page' : undefined"
                        @click="selectComponent(component.id)"
                    >
                        <span>{{ component.label }}</span>
                        <span class="i-lucide-chevron-right" aria-hidden="true"></span>
                    </button>
                </section>
            </nav>
        </aside>

        <section class="lab-main">
            <header class="lab-stage-toolbar">
                <div class="lab-stage-toolbar__group">
                    <div class="lab-stage-toolbar__name">
                        <strong>{{ activeDefinition.label }}</strong>
                        <span>{{ activeDefinition.description }}</span>
                    </div>
                    <select v-model="session.sceneId.value" class="lab-native-select" aria-label="组件场景">
                        <option v-for="scene in activeDefinition.scenes" :key="scene.id" :value="scene.id">{{ scene.label }}</option>
                    </select>
                </div>
                <div class="lab-stage-toolbar__group">
                    <select v-model="session.viewportId.value" class="lab-native-select" aria-label="预览宽度">
                        <option v-for="viewport in labViewports" :key="viewport.id" :value="viewport.id">{{ viewportLabel(viewport) }}</option>
                    </select>
                    <select :value="theme.current.value ?? ''" class="lab-native-select" aria-label="主题" @change="changeTheme">
                        <option value="">裸基线</option>
                        <option v-for="installed in theme.themes.value" :key="installed.manifest.id" :value="installed.manifest.id">{{ installed.manifest.name }}</option>
                    </select>
                    <select :value="colorway.current.value" class="lab-native-select" aria-label="配色" @change="changeColorway">
                        <option v-for="id in colorway.colorwayIds" :key="id" :value="id">{{ colorway.colorwayMeta[id]?.label ?? id }}</option>
                    </select>
                </div>
            </header>

            <div class="lab-canvas-scroll">
                <div class="lab-canvas" :style="{width: canvasWidth}">
                    <LabPreview :component-id="session.componentId.value" :scene-id="session.sceneId.value" @lab-event="recordEvent" @rendered="inspectRevision += 1" />
                </div>
            </div>
        </section>

        <aside class="lab-inspector" aria-label="组件检查器">
            <header class="lab-inspector__header">
                <nav class="lab-inspector-tabs" aria-label="检查器标签">
                    <button type="button" :class="{'is-active': activeInspectorTab === 'variables'}" @click="activeInspectorTab = 'variables'">变量 <span v-if="labOverrides.count.value" class="lab-override-count">{{ labOverrides.count.value }}</span></button>
                    <button type="button" :class="{'is-active': activeInspectorTab === 'inspection'}" @click="activeInspectorTab = 'inspection'">检查</button>
                    <button type="button" :class="{'is-active': activeInspectorTab === 'events'}" @click="activeInspectorTab = 'events'">事件 <span v-if="events.length" class="lab-override-count">{{ events.length }}</span></button>
                </nav>
                <div class="lab-inspector-actions">
                    <button type="button" class="lab-icon-action" title="重置全部变量" aria-label="重置全部变量" @click="resetAllOverrides">
                        <span class="i-lucide-rotate-ccw" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="lab-icon-action" title="导入变量快照" aria-label="导入变量快照" @click="openImport">
                        <span class="i-lucide-upload" aria-hidden="true"></span>
                    </button>
                    <button type="button" class="lab-icon-action" title="导出变量快照" aria-label="导出变量快照" @click="downloadSnapshot">
                        <span class="i-lucide-download" aria-hidden="true"></span>
                    </button>
                    <input ref="importInput" type="file" accept="application/json,.json" hidden @change="importSnapshot">
                </div>
            </header>
            <p v-if="statusMessage" class="lab-status" :class="{'is-error': statusIsError}">{{ statusMessage }}</p>
            <div class="lab-inspector__body">
                <LabVariableEditor
                    v-if="activeInspectorTab === 'variables'"
                    :groups="tokenGroups"
                    :resolved-values="resolvedValues"
                    :overrides="labOverrides.overrides.value"
                    @update="updateOverride"
                    @reset="resetOverride"
                />
                <LabInspector
                    v-else
                    :mode="activeInspectorTab === 'events' ? 'events' : 'inspection'"
                    :target-selector="activeDefinition.targetSelector"
                    :scene-id="session.sceneId.value"
                    :revision="inspectRevision"
                    :events="events"
                    @clear-events="clearEvents"
                />
            </div>
        </aside>
    </main>
</template>
