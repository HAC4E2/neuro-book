<script setup lang="ts">
import {onClickOutside} from "@vueuse/core";
import {nextTick, ref, useId} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import type {DropdownItem} from "./dropdown.types";

const props = withDefaults(defineProps<{
    items: DropdownItem[];
    menuClass?: string;
    menuMaxHeight?: string;
    rootClass?: string;
    compact?: boolean;
}>(), {
    menuClass: "left-0 top-full mt-2 min-w-full",
    menuMaxHeight: "none",
    rootClass: "relative w-full",
    compact: false,
});

const emit = defineEmits<{
    (e: "select", value: string): void;
}>();

const open = ref(false);
const rootRef = ref<HTMLDivElement | null>(null);
const triggerRef = ref<HTMLDivElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const menuId = `nb-dropdown-${useId()}`;

function toggle(): void {
    open.value = !open.value;
}

function close(): void {
    open.value = false;
}

function select(item: DropdownItem): void {
    if (item.disabled) {
        return;
    }
    emit("select", item.value);
    open.value = false;
    void nextTick(focusTrigger);
}

/** 把焦点归还给触发器内第一个可聚焦元素 */
function focusTrigger(): void {
    triggerRef.value?.querySelector<HTMLElement>("button,a,[tabindex]")?.focus();
}

/** 菜单内可聚焦的菜单项（separator 是 div，天然不在列） */
function menuItems(): HTMLButtonElement[] {
    return Array.from(menuRef.value?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']:not(:disabled)") ?? []);
}

function focusItemAt(position: "first" | "last"): void {
    void nextTick(() => {
        const items = menuItems();
        (position === "first" ? items[0] : items[items.length - 1])?.focus();
    });
}

function handleTriggerArrowDown(event: KeyboardEvent): void {
    event.preventDefault();
    open.value = true;
    focusItemAt("first");
}

function handleTriggerArrowUp(event: KeyboardEvent): void {
    event.preventDefault();
    open.value = true;
    focusItemAt("last");
}

/** 菜单内键盘导航：方向键循环、Home/End 跳边界、Tab 关闭 */
function handleMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab") {
        open.value = false;
        return;
    }
    const items = menuItems();
    if (items.length === 0) {
        return;
    }
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        next = current === -1 ? items[0] : items[(current + delta + items.length) % items.length];
    } else if (event.key === "Home") {
        next = items[0];
    } else if (event.key === "End") {
        next = items[items.length - 1];
    }
    if (next) {
        event.preventDefault();
        next.focus();
    }
}

/** Esc 关闭菜单并把焦点归还触发器 */
function handleEscape(): void {
    const wasOpen = open.value;
    close();
    if (wasOpen) {
        focusTrigger();
    }
}

/** 菜单项外观：danger 走共享的危险菜单项基座，用于破坏性动作 */
function itemClass(item: DropdownItem): string {
    if (item.tone === "danger") {
        return "nb-ui-menu-item-danger";
    }
    if (item.active) {
        return "bg-[var(--overlay-item-active)] text-[var(--text-main)]";
    }
    return "text-[var(--text-secondary)] hover:bg-[var(--overlay-item-active)] hover:text-[var(--text-main)]";
}

onClickOutside(rootRef, close);
</script>

<template>
    <!-- 下拉菜单容器 -->
    <div ref="rootRef" :class="props.rootClass" @keydown.esc.prevent.stop="handleEscape">
        <div ref="triggerRef" class="w-full" aria-haspopup="menu" :aria-expanded="open" :aria-controls="menuId" @click.stop="toggle" @keydown.down="handleTriggerArrowDown" @keydown.up="handleTriggerArrowUp">
            <slot />
        </div>
        <Transition name="nb-popover">
        <div
            v-if="open"
            :id="menuId"
            ref="menuRef"
            role="menu"
            :style="{zIndex: NB_Z_INDEX.popover}"
            class="nb-ui-popover-surface nb-ui-menu-surface nb-ui-popover-motion absolute overflow-hidden p-1.5"
            :class="props.menuClass"
            @keydown="handleMenuKeydown"
        >
            <!--
                滚动挂在**内层**，不挂在浮层本体上。挂本体上同时坏两件事：滚动条画进 --radius-panel
                的圆角里被弧线削掉两头（看起来像描边裂了个口子），首尾两项也会贴着圆角被横切。
                判据与完整理由见 styles.css 的 .nb-ui-popover-scroll。

                role="none" 是给这层包装用的：菜单项仍要读作 role="menu" 的项，
                中间这一层不该出现在无障碍树里。键盘导航走 querySelectorAll（后代查询），
                多一层包装不影响。
            -->
            <div
                role="none"
                class="nb-ui-popover-scroll"
                :style="{maxHeight: props.menuMaxHeight, borderRadius: 'var(--nb-popover-inner-radius)'}"
            >
                <template v-for="item in props.items" :key="item.value">
                    <div v-if="item.separator" role="separator" class="mx-[var(--space-2)] my-[var(--space-1)] border-t-[length:var(--border-w)] border-[color:var(--divider)]"></div>
                    <button
                        v-else
                        type="button"
                        role="menuitem"
                        class="nb-ui-popover-item mb-1 flex h-[var(--control-h-sm)] w-full items-center justify-between gap-[var(--space-3)] rounded-[max(2px,calc(var(--radius-panel)-var(--space-2)))] px-[var(--space-4)] text-left transition-colors last:mb-0 disabled:cursor-not-allowed disabled:opacity-45"
                        :class="[
                            props.compact ? 'text-[var(--text-xs)]' : 'text-[var(--text-sm)]',
                            itemClass(item),
                        ]"
                        :disabled="item.disabled"
                        @click.stop="select(item)"
                    >
                        <span class="inline-flex min-w-0 items-center gap-[var(--space-2)]">
                            <span v-if="item.iconClass" class="h-[1.15em] w-[1.15em] shrink-0" :class="[item.iconClass, item.tone === 'danger' ? 'text-current opacity-90' : 'text-[var(--text-muted)]']"></span>
                            <span class="truncate">{{ item.label }}</span>
                        </span>
                        <span v-if="item.rightIconClass" :class="item.rightIconClass" class="h-[1.15em] w-[1.15em] shrink-0 text-[var(--accent-text)]"></span>
                    </button>
                </template>
            </div>
        </div>
        </Transition>
    </div>
</template>
