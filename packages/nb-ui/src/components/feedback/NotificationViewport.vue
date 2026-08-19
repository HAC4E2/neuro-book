<script setup lang="ts">
import {computed} from "vue";
import {NB_Z_INDEX} from "../../theme/z-index";
import {useNotification, type NotificationItem} from "../../composables/useNotification";
import Notification from "./Notification.vue";
import type {NotificationTone} from "./Notification.vue";

export type NotificationPosition = "bottom-center" | "bottom-right" | "top-right";

const props = withDefaults(defineProps<{
    position?: NotificationPosition;
    closeLabel?: string;
}>(), {
    position: "bottom-center",
    closeLabel: "关闭通知",
});

const {notifications, remove, pause, resume} = useNotification();

const positionClass = computed(() => {
    if (props.position === "top-right") {
        return "right-4 top-4 items-end";
    }
    if (props.position === "bottom-right") {
        return "bottom-4 right-4 items-end";
    }
    return "bottom-4 left-1/2 -translate-x-1/2 items-center";
});

function toneClass(item: NotificationItem): NotificationTone {
    return item.tone;
}
</script>

<template>
    <ClientOnly>
        <div class="pointer-events-none fixed flex w-full max-w-md flex-col gap-2 px-4" :style="{zIndex: NB_Z_INDEX.notification}" :class="positionClass">
            <TransitionGroup name="nb-notice">
                <Notification
                    v-for="item in notifications"
                    :key="item.id"
                    class="pointer-events-auto"
                    :tone="toneClass(item)"
                    :title="item.title"
                    :message="item.message"
                    :dismissible="true"
                    :action-label="item.action?.label"
                    :close-label="props.closeLabel"
                    @mouseenter="pause(item.id)"
                    @mouseleave="resume(item.id)"
                    @action="item.action?.run(); remove(item.id)"
                    @dismiss="remove(item.id)"
                />
            </TransitionGroup>
        </div>
    </ClientOnly>
</template>

<style scoped>
.nb-notice-enter-active,
.nb-notice-leave-active {
    transition: all 0.18s ease;
}

.nb-notice-enter-from,
.nb-notice-leave-to {
    opacity: 0;
    transform: translateY(8px);
}
</style>
