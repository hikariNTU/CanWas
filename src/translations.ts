import { atom, useAtomValue } from "jotai";
import { useCallback } from "react";

export type ProvidedLang = "zh-TW" | "en-US";
export type TranslationsKey = keyof typeof translations;

const preferredLangKey = "canwas.preferredLang";
const langAtom = atom<ProvidedLang>(getPreferredLang());

export const currentLangAtom = atom(
  (get) => get(langAtom),
  (_, set, val: ProvidedLang) => {
    localStorage.setItem(preferredLangKey, val);
    set(langAtom, val);
  },
);

export function useTranslation() {
  const lang = useAtomValue(currentLangAtom);
  const t = useCallback(
    (key: TranslationsKey) => translations[key][lang],
    [lang],
  );
  return { t, lang };
}

function getPreferredLang(): ProvidedLang {
  const stored = localStorage.getItem(preferredLangKey);
  if (stored === "zh-TW" || stored === "en-US") {
    return stored;
  }
  return navigator.language.startsWith("zh") ? "zh-TW" : "en-US";
}

/**
 * Every user-visible string lives here, including aria-labels and empty-state
 * copy. Keys are namespaced by area. No sentence is built by concatenation —
 * word order differs between the two locales.
 */
const translations = {
  "app.name": {
    "zh-TW": "CanWas",
    "en-US": "CanWas",
  },
  "app.tagline": {
    "zh-TW": "貼上截圖，選取其中的文字。",
    "en-US": "Paste screenshots. Select the text inside them.",
  },
  "lang.label": {
    "zh-TW": "語言",
    "en-US": "Language",
  },
  "home.title": {
    "zh-TW": "畫板",
    "en-US": "Boards",
  },
  "home.empty": {
    "zh-TW": "還沒有任何畫板。",
    "en-US": "No boards yet.",
  },
  "home.openDemo": {
    "zh-TW": "開啟範例畫板",
    "en-US": "Open demo board",
  },
  "board.back": {
    "zh-TW": "返回畫板列表",
    "en-US": "Back to boards",
  },
  "board.placeholder": {
    "zh-TW": "畫布尚未實作。這裡之後會是無限畫布。",
    "en-US": "Canvas not implemented yet. The infinite canvas lands here.",
  },
} satisfies Record<string, Record<ProvidedLang, string>>;
