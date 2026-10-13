/**
 * 最近打开（docs/specs/workbench/editor.md 输出 31）：绑定项目的窗口把打开过的地址按最近在前存进 project/local 记录
 * `editor.recent`，至多 10 个，供欢迎页列出。地址只在打开时记，改名、删除不回头改：读的一方按需核对文件还在不在。
 */

import {Type} from "typebox";

import {RESOURCE_PATH_PATTERN} from "nbook/plugins/files/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

export const MAX_RECENT = 10;

const ADDRESS_PATTERN = `^(?:project|user)://${RESOURCE_PATH_PATTERN.slice(1)}`;

export const EDITOR_RECENT_RECORD = defineRecord({
    key: "editor.recent",
    scope: "project",
    locality: "local",
    version: 1,
    schema: Type.Object({addresses: Type.Array(Type.String({pattern: ADDRESS_PATTERN}), {maxItems: MAX_RECENT, uniqueItems: true})}, {additionalProperties: false}),
});

export const editorRecentStore = defineStore("editor-recent", ({persist}) => {
    const recent = persist(EDITOR_RECENT_RECORD, {initial: {addresses: []}});
    return {
        state: {recent},
        actions: {
            /** 打开了一个地址：移到最前，超出上限的从末尾丢掉；已经在最前时不写。 */
            opened: (address: string): void => {
                if (recent.display.addresses[0] === address) return;
                void recent.commit((value) => ({addresses: [address, ...value.addresses.filter((candidate) => candidate !== address)].slice(0, MAX_RECENT)}));
            },
        },
    };
});

export type EditorRecentStore = ReturnType<typeof editorRecentStore.create>;
