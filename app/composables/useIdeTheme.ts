import type { Ref } from "vue";
import { applyThemeVars } from "nbook/app/utils/theme/apply-theme";
import { IDE_THEME_HOST_CLASS, type IdeTheme, themeTokens } from "nbook/app/utils/theme/theme-tokens";

const themeHost = shallowRef<HTMLElement | null>(null);

/**
 * 把当前主题应用到当前宿主节点。
 */
const applyThemeToHost = (theme: IdeTheme): void => {
    if (!themeHost.value) {
        return;
    }

    themeHost.value.classList.add(IDE_THEME_HOST_CLASS);
    applyThemeVars(themeHost.value, themeTokens[theme]);
};

/**
 * 把外部主题状态挂到 IDE 宿主元素上。
 */
export const useIdeTheme = (theme: Ref<IdeTheme>) => {
    /**
     * 挂载主题宿主。
     */
    const mountThemeHost = (host: HTMLElement | null): void => {
        themeHost.value = host;
        applyThemeToHost(theme.value);
    };

    /**
     * 切换主题。
     */
    const setTheme = (nextTheme: IdeTheme): void => {
        theme.value = nextTheme;
        applyThemeToHost(nextTheme);
    };

    watch(theme, (nextTheme) => {
        applyThemeToHost(nextTheme);
    });

    return {
        mountThemeHost,
        setTheme,
    };
};
