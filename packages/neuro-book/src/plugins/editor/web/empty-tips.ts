/**
 * 空编辑组的提示（docs/specs/workbench/editor.md 输出 32）：几条常用入口，各对应一条命令。命令由别的插件登记，这里只按 id
 * 引用：命令不存在或此刻不可用时那一行不显示；命令声明了快捷键就写出按键（按平台），没有的写出它在界面上的位置。
 */

import {formatKeybinding} from "nbook/plugins/commands/shared/contracts";
import type {CommandService, KeyPlatform} from "nbook/plugins/commands/shared/contracts";
import type {DisplayLocale} from "nbook/shared/localized-text";

import {editorText} from "./messages";

export interface EmptyTip {
    readonly command: string;
    readonly label: string;
    /** 快捷键拆成的按键（mac 是一串符号，整串一个）；没有快捷键为 null。 */
    readonly keys: ReadonlyArray<string> | null;
    /** 没有快捷键时写出入口的位置；有快捷键时为 null。 */
    readonly hint: string | null;
}

const TIPS = [
    {command: "nbook.quick-open.open-commands", label: "tipCommands", hint: null},
    {command: "nbook.files.new-file", label: "tipNewFile", hint: "tipNewFileWhere"},
    {command: "nbook.help.welcome", label: "tipWelcome", hint: "tipWelcomeWhere"},
] as const;

export function emptyTips(commands: Pick<CommandService, "get" | "isEnabled">, locale: DisplayLocale, platform: KeyPlatform): EmptyTip[] {
    return TIPS.flatMap((tip): EmptyTip[] => {
        const command = commands.get(tip.command);
        const enabled = commands.isEnabled(tip.command);
        if (!command.ok || !enabled.ok || !enabled.value) return [];
        const keybinding = command.value.keybinding;
        if (keybinding !== undefined) {
            // 其它平台写成 Ctrl+Shift+P，按加号拆成键；mac 的写法（⇧⌘P）没有加号，拆出来就是整串一个。
            return [{command: tip.command, label: editorText(locale, tip.label), keys: formatKeybinding(keybinding, platform).split("+"), hint: null}];
        }
        return [{command: tip.command, label: editorText(locale, tip.label), keys: null, hint: tip.hint === null ? null : editorText(locale, tip.hint)}];
    });
}
