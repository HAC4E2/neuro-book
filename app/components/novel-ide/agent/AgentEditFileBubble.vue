<script setup lang="ts">
import { computed } from "vue";
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";
import {
    extractStreamingBooleanField,
    extractStreamingStringField,
    parseToolArgsObject,
} from "nbook/app/components/novel-ide/agent/tool-args-stream";

const props = defineProps<{
    toolCall: AgentToolCall;
}>();

interface EditFileArgs {
    filePath?: string;
    oldString?: string;
    newString?: string;
    replaceAll?: boolean;
}

/** edit_file 参数在流式阶段可能是半截 JSON，需要按字段兜底展示。 */
const parsedArgs = computed<EditFileArgs>(() => {
    const parsed = parseToolArgsObject<EditFileArgs>(props.toolCall.argsJson ?? props.toolCall.argsText);
    return parsed ?? {};
});

const filePathText = computed(() => parsedArgs.value.filePath ?? extractStreamingStringField(props.toolCall.argsText, "filePath"));
const oldStringText = computed(() => parsedArgs.value.oldString ?? extractStreamingStringField(props.toolCall.argsText, "oldString"));
const newStringText = computed(() => parsedArgs.value.newString ?? extractStreamingStringField(props.toolCall.argsText, "newString"));
const replaceAllValue = computed(() => {
    if (typeof parsedArgs.value.replaceAll === "boolean") {
        return parsedArgs.value.replaceAll;
    }
    return extractStreamingBooleanField(props.toolCall.argsText, "replaceAll");
});

const resultText = computed(() => props.toolCall.result?.trim() ?? "");
</script>

<template>
    <div class="mt-2 space-y-3">
        <!-- Tool 目标路径 -->
        <div class="flex items-center gap-2">
            <span class="rounded bg-[var(--bg-main)] px-2 py-1 font-mono text-[11px] text-[var(--accent-main)] border border-[var(--accent-main)]/30">
                <span class="i-lucide-file-edit h-3 w-3 mr-1 inline-block align-text-bottom"></span>
                {{ filePathText || "解析路径中..." }}
            </span>
            <span v-if="replaceAllValue !== null" class="rounded border border-[var(--border-color)] bg-[var(--bg-panel)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
                replaceAll: {{ replaceAllValue ? "true" : "false" }}
            </span>
        </div>
        
        <!-- Diff 预览：old/new 都允许在半截 JSON 阶段逐步增长 -->
        <div class="grid grid-cols-2 gap-2 mt-2">
            <div class="rounded border border-[var(--border-color)] bg-rose-500/5">
                <div class="px-2 py-1 border-b border-[var(--border-color)]/50 text-[10px] text-rose-500/80 uppercase">Old String</div>
                <div class="p-2 font-mono text-xs whitespace-pre-wrap text-rose-500 line-through opacity-80 max-h-40 overflow-y-auto">
                    {{ oldStringText || "..." }}
                </div>
            </div>
            
            <div class="rounded border border-[var(--border-color)] bg-green-500/5">
                <div class="px-2 py-1 border-b border-[var(--border-color)]/50 text-[10px] text-green-500/80 uppercase">New String</div>
                <div class="p-2 font-mono text-xs whitespace-pre-wrap text-green-500 max-h-40 overflow-y-auto">
                    {{ newStringText || "..." }}
                </div>
            </div>
        </div>

        <div v-if="props.toolCall.error" class="break-all whitespace-pre-wrap rounded border border-rose-500/30 bg-rose-500/5 p-2 font-mono text-xs text-rose-500 mt-2">
            {{ props.toolCall.error }}
        </div>
        
        <div v-if="resultText" class="whitespace-pre-wrap rounded border border-[var(--border-color)] bg-[var(--bg-panel)] p-2 font-mono text-xs leading-5 text-[var(--text-secondary)]">
            {{ resultText }}
        </div>

        <div v-if="props.toolCall.status === 'success'" class="flex items-center text-[11px] text-green-500/80 mt-2 gap-1.5 font-medium">
            <span class="i-lucide-check-circle h-3.5 w-3.5"></span>
            文件修改成功
        </div>
    </div>
</template>
