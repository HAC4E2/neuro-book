import {ref, watch} from "vue";
import {useRoute, useRouter} from "vue-router";
import {
    getLabComponent,
    isLabComponentId,
    isLabViewportId,
    labComponents,
    type LabComponentId,
    type LabViewportId,
} from "./registry";

function queryString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function initialComponent(value: unknown): LabComponentId {
    const candidate = queryString(value);
    return candidate !== null && isLabComponentId(candidate) ? candidate : labComponents[0]!.id;
}

function initialScene(componentId: LabComponentId, value: unknown): string {
    const candidate = queryString(value);
    const scenes = getLabComponent(componentId).scenes;
    return candidate !== null && scenes.some((scene) => scene.id === candidate) ? candidate : scenes[0]!.id;
}

function initialViewport(value: unknown): LabViewportId {
    const candidate = queryString(value);
    return candidate !== null && isLabViewportId(candidate) ? candidate : "responsive";
}

export function useLabSession() {
    const route = useRoute();
    const router = useRouter();
    const componentId = ref(initialComponent(route.query.component));
    const sceneId = ref(initialScene(componentId.value, route.query.scene));
    const viewportId = ref(initialViewport(route.query.viewport));
    const themeId = ref(queryString(route.query.theme));
    const colorwayId = ref(queryString(route.query.colorway));
    const initialQuery = {...route.query};
    if (
        initialQuery.component !== componentId.value
        || initialQuery.scene !== sceneId.value
        || initialQuery.viewport !== viewportId.value
    ) {
        void router.replace({query: {
            ...initialQuery,
            component: componentId.value,
            scene: sceneId.value,
            viewport: viewportId.value,
        }});
    }


    function replaceQuery(): void {
        const query = {...route.query};
        query.component = componentId.value;
        query.scene = sceneId.value;
        query.viewport = viewportId.value;
        if (themeId.value === null || themeId.value === "") delete query.theme;
        else query.theme = themeId.value;
        if (colorwayId.value === null || colorwayId.value === "") delete query.colorway;
        else query.colorway = colorwayId.value;
        void router.replace({query});
    }

    watch(componentId, (next) => {
        const scenes = getLabComponent(next).scenes;
        if (!scenes.some((scene) => scene.id === sceneId.value)) sceneId.value = scenes[0]!.id;
    });

    watch([componentId, sceneId, viewportId, themeId, colorwayId], replaceQuery, {flush: "post"});

    watch(() => route.query, (query) => {
        const nextComponent = initialComponent(query.component);
        const nextScene = initialScene(nextComponent, query.scene);
        const nextViewport = initialViewport(query.viewport);
        const nextTheme = queryString(query.theme);
        const nextColorway = queryString(query.colorway);
        if (componentId.value !== nextComponent) componentId.value = nextComponent;
        if (sceneId.value !== nextScene) sceneId.value = nextScene;
        if (viewportId.value !== nextViewport) viewportId.value = nextViewport;
        if (themeId.value !== nextTheme) themeId.value = nextTheme;
        if (colorwayId.value !== nextColorway) colorwayId.value = nextColorway;
    });

    return {
        componentId,
        sceneId,
        viewportId,
        themeId,
        colorwayId,
        setThemeId: (id: string | null) => { themeId.value = id; },
        setColorwayId: (id: string | null) => { colorwayId.value = id; },
    };
}
