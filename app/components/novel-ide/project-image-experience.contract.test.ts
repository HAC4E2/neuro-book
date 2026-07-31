import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const pickerPath = fileURLToPath(new URL("./ProjectPickerScreen.vue", import.meta.url));
const previewPath = fileURLToPath(new URL("../common/OriginalImagePreviewDialog.vue", import.meta.url));
const chatAttachmentPath = fileURLToPath(new URL("./agent/AgentAttachmentCard.vue", import.meta.url));
const chatGalleryPath = fileURLToPath(new URL("./agent/AgentAttachmentGallery.vue", import.meta.url));
const chatBubblePath = fileURLToPath(new URL("./agent/AgentTextBubble.vue", import.meta.url));
const toolBubblePath = fileURLToPath(new URL("./agent/AgentToolBubble.vue", import.meta.url));
const attachmentPanelPath = fileURLToPath(new URL("./agent/AgentSessionAttachmentPanel.vue", import.meta.url));

describe("Project 与 Attachment 图片体验合同", () => {
    it("书架懒加载固定封面 preset，并通过专用 mutation 原位刷新单本 Project", async () => {
        const picker = await readFile(pickerPath, "utf8");

        expect(picker).toContain('new URLSearchParams({projectRoot, preset: "project-cover"})');
        expect(picker).toContain('loading="lazy" decoding="async"');
        expect(picker).toContain('{method: "PUT", body}');
        expect(picker).toContain('{method: "DELETE"}');
        expect(picker.match(/applyProjectMutation\(result\.project\)/gu)).toHaveLength(2);
        expect(picker).toContain("coverRefreshVersions.value = {");
        expect(picker).toContain('resolveProjectMutationCommitState(error, "cover-update")');
        expect(picker).toContain("await refreshCoverMutationState(projectRoot)");
        expect(picker).toContain("coverNeedsRefresh");
        expect(picker).toContain("coverRecoveries");
        expect(picker).toContain("settleProjectCoverRecoverySnapshot({");
        expect(picker).toContain("for (const projectRoot of settlement.cacheBustRoots)");
        expect(picker).toContain("settleCoverRecoverySnapshot(list, focusedProjectRoot)");
        expect(picker).toContain("settleCoverRecoverySnapshot(list, projectRoot)");
        expect(picker.match(/settleCoverRecoverySnapshot\(novels\.value\)/gu)).toHaveLength(2);
        expect(picker.match(/\{method: "PUT", body\}/gu)).toHaveLength(1);
        expect(picker.match(/\{method: "DELETE"\}/gu)).toHaveLength(1);
        expect(picker).not.toContain("coverRecoveryRoot");
        expect(picker).not.toContain("`${project.title}-cover`");
        expect(picker).not.toContain("/api/auth/");
    });

    it("聊天与附件面板使用各自 preset，并共用按需原图预览", async () => {
        const [chatAttachment, chatGallery, chatBubble, toolBubble, attachmentPanel] = await Promise.all([
            readFile(chatAttachmentPath, "utf8"),
            readFile(chatGalleryPath, "utf8"),
            readFile(chatBubblePath, "utf8"),
            readFile(toolBubblePath, "utf8"),
            readFile(attachmentPanelPath, "utf8"),
        ]);

        expect(chatAttachment).toContain('"attachment-chat"');
        expect(chatAttachment).toContain('v-if="isImage"');
        expect(chatAttachment).toContain('v-else class="flex w-full');
        expect(chatAttachment).toContain(':href="originalUrl"');
        expect(chatAttachment).toContain("t('agent.chat.downloadAttachment')");
        expect(chatGallery).toContain("AgentAttachmentCard");
        expect(chatBubble).toContain("AgentAttachmentCard");
        expect(toolBubble).toContain("AgentAttachmentGallery");
        expect(toolBubble).toContain('v-if="resultAttachments.length > 0"');
        expect(toolBubble).not.toContain("props.toolCall.resultEntryId && resultAttachments.length");
        expect(chatGallery).not.toContain("AgentAttachmentImage");
        expect(chatBubble).not.toContain("AgentAttachmentImage");
        expect(attachmentPanel).toContain('"attachment-grid"');
        expect(attachmentPanel).toContain("canonicalImageMime(item.attachment.mimeType)");
        expect(attachmentPanel).toContain('v-if="isImage(item)"');
        expect(attachmentPanel).toContain('t("agent.attachments.downloadFile")');
        for (const source of [chatAttachment, attachmentPanel]) {
            expect(source).toContain('import OriginalImagePreviewDialog from "nbook/app/components/common/OriginalImagePreviewDialog.vue"');
            expect(source).toContain("<OriginalImagePreviewDialog");
        }
    });

    it("共享预览只在打开时挂载无参数原图，并提供原图下载", async () => {
        const preview = await readFile(previewPath, "utf8");

        expect(preview).toContain('v-if="modelValue && src && loadState !== \'error\'"');
        expect(preview).toContain(':href="src"');
        expect(preview).toContain(':download="downloadName || \'\'"');
        expect(preview).not.toContain("preset=");
    });
});
