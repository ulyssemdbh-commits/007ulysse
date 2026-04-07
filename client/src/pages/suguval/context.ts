import { createContext, useContext } from "react";

export const SuguThemeCtx = createContext(true);
export function useSuguDark() { return useContext(SuguThemeCtx); }
export function t(dark: boolean, darkCls: string, lightCls: string) { return dark ? darkCls : lightCls; }
