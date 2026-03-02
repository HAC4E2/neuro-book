<template>
    <Teleport v-if="isMounted" :to="`.${IDE_THEME_HOST_CLASS}`">
        <Transition name="fade">
            <div
                v-if="visible"
                ref="menuRef"
                class="fixed z-[9100] min-w-[170px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-panel)] p-1 text-[var(--text-main)] shadow-xl"
                :style="{top: `${adjustedY}px`, left: `${adjustedX}px`}"
                @click.stop
                @contextmenu.prevent
            >
                <template v-for="(item, index) in items" :key="index">
                    <div v-if="item.separator" class="mx-1 my-1 h-px bg-[var(--border-color)]/50"></div>
                    <button
                        v-else
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                        :class="item.danger ? 'hover:bg-rose-500/10 hover:text-rose-500 disabled:hover:bg-transparent disabled:hover:text-[var(--text-main)]' : 'hover:bg-[var(--bg-hover)]'"
                        :disabled="item.disabled"
                        @click="handleItemClick(item)"
                    >
                        <span v-if="item.iconClass" :class="item.iconClass" class="h-4 w-4 shrink-0"></span>
                        <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                        <span v-if="item.shortcut" class="ml-4 shrink-0 text-[11px] text-[var(--text-muted)]">{{ item.shortcut }}</span>
                    </button>
                </template>
            </div>
        </Transition>
    </Teleport>
</template>

<script lang="ts">
export interface ContextMenuItem {
    label?: string;
    iconClass?: string;
    shortcut?: string;
    action?: () => void;
    disabled?: boolean;
    danger?: boolean;
    separator?: boolean;
}
</script>

<script setup lang="ts">
import {IDE_THEME_HOST_CLASS} from "nbook/app/utils/theme/theme-tokens";

const props = defineProps<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
}>();

const emit = defineEmits<{
    (e: "close"): void;
}>();

const menuRef = ref<HTMLElement | null>(null);
const adjustedX = ref(props.x);
const adjustedY = ref(props.y);
const isMounted = ref(false);

/**
 * 执行菜单动作并关闭菜单。
 */
const handleItemClick = (item: ContextMenuItem): void => {
    if (item.disabled) {
        return;
    }
    item.action?.();
    emit("close");
};

/**
 * 点击或右键到菜单外部时关闭菜单。
 */
const closeMenu = (event: MouseEvent): void => {
    if (menuRef.value?.contains(event.target as Node)) {
        return;
    }
    emit("close");
};

onMounted(() => {
    isMounted.value = true;
    document.addEventListener("click", closeMenu, true);
    document.addEventListener("contextmenu", closeMenu, true);
});

onUnmounted(() => {
    document.removeEventListener("click", closeMenu, true);
    document.removeEventListener("contextmenu", closeMenu, true);
});

watch(() => [props.visible, props.x, props.y], async ([visible, x, y]) => {
    if (!visible) {
        return;
    }

    adjustedX.value = x as number;
    adjustedY.value = y as number;
    await nextTick();

    if (!menuRef.value) {
        return;
    }

    const rect = menuRef.value.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;
    if ((x as number) + rect.width > winWidth) {
        adjustedX.value = Math.max(8, winWidth - rect.width - 8);
    }
    if ((y as number) + rect.height > winHeight) {
        adjustedY.value = Math.max(8, winHeight - rect.height - 8);
    }
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.15s ease, transform 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
    transform: scale(0.96);
}
</style>
