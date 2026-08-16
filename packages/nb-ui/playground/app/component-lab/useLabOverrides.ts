import {computed, onBeforeUnmount, onMounted, ref, watch} from "vue";
import type {ComputedRef} from "vue";
import {
    parseLabOverrideSnapshot,
    serializeLabOverrideSnapshot,
} from "./lab-overrides";

const STORAGE_KEY = "nb-ui-component-lab-overrides-v1";
const STYLE_ID = "nb-ui-component-lab-overrides";

export function useLabOverrides(allowedNames: ComputedRef<ReadonlySet<string>>) {
    const overrides = ref<Record<string, string>>({});
    const hydrated = ref(false);
    const count = computed(() => Object.keys(overrides.value).length);

    function renderLayer(): void {
        if (typeof document === "undefined") return;
        let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
        if (style === null) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        const declarations = Object.entries(overrides.value)
            .map(([name, value]) => `    ${name}: ${value} !important;`)
            .join("\n");
        style.textContent = declarations.length === 0
            ? ""
            : `:root[data-nb-lab-active], :root[data-nb-lab-active] body {\n${declarations}\n}`;
        document.documentElement.dataset.nbLabActive = "";
    }

    function setOverride(name: string, value: string): void {
        if (!allowedNames.value.has(name)) {
            throw new Error(`未登记的变量：${name}`);
        }
        if (value.trim() === "") {
            const next = {...overrides.value};
            delete next[name];
            overrides.value = next;
            return;
        }
        const next = parseLabOverrideSnapshot(serializeLabOverrideSnapshot({[name]: value}), new Set([name]));
        overrides.value = {...overrides.value, ...next};
    }

    function resetOverride(name: string): void {
        const next = {...overrides.value};
        delete next[name];
        overrides.value = next;
    }

    function resetAll(): void {
        overrides.value = {};
    }

    function importSnapshot(raw: string): number {
        const next = parseLabOverrideSnapshot(raw, allowedNames.value);
        overrides.value = next;
        return Object.keys(next).length;
    }

    function exportSnapshot(): string {
        return serializeLabOverrideSnapshot(overrides.value);
    }

    onMounted(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) importSnapshot(stored);
        } catch (error) {
            console.warn("[nb-ui lab] 无法恢复变量草稿", error);
        } finally {
            hydrated.value = true;
            renderLayer();
        }
    });

    watch(overrides, () => {
        renderLayer();
        if (!hydrated.value) return;
        try {
            localStorage.setItem(STORAGE_KEY, exportSnapshot());
        } catch (error) {
            console.warn("[nb-ui lab] 无法保存变量草稿", error);
        }
    }, {deep: true});

    onBeforeUnmount(() => {
        if (typeof document === "undefined") return;
        document.getElementById(STYLE_ID)?.remove();
        delete document.documentElement.dataset.nbLabActive;
    });

    return {
        overrides,
        count,
        setOverride,
        resetOverride,
        resetAll,
        importSnapshot,
        exportSnapshot,
    };
}
