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
  "menu.open": {
    "zh-TW": "選單",
    "en-US": "Menu",
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
  "home.create": {
    "zh-TW": "新增畫板",
    "en-US": "New board",
  },
  "home.untitled": {
    "zh-TW": "未命名畫板",
    "en-US": "Untitled board",
  },
  "home.delete": {
    "zh-TW": "刪除",
    "en-US": "Delete",
  },
  "home.deleteTitle": {
    "zh-TW": "刪除這個畫板？",
    "en-US": "Delete this board?",
  },
  "home.deleteBody": {
    "zh-TW": "這個動作無法復原。畫板與其中的排列都會被移除。",
    "en-US":
      "This cannot be undone. The board and its arrangement are removed.",
  },
  "common.cancel": {
    "zh-TW": "取消",
    "en-US": "Cancel",
  },
  "board.back": {
    "zh-TW": "返回畫板列表",
    "en-US": "Back to boards",
  },
  "canvas.hint": {
    "zh-TW": "拖曳以平移，捲動以平移，Shift 或 ⌘ 加捲動以縮放",
    "en-US": "Drag to pan · scroll to pan · shift or ⌘ + scroll to zoom",
  },
  "canvas.empty": {
    "zh-TW": "貼上或拖曳圖片到這裡",
    "en-US": "Paste or drop an image here",
  },
  "canvas.undo": {
    "zh-TW": "復原",
    "en-US": "Undo",
  },
  "canvas.redo": {
    "zh-TW": "重做",
    "en-US": "Redo",
  },
  "canvas.zoomIn": {
    "zh-TW": "放大",
    "en-US": "Zoom in",
  },
  "canvas.zoomOut": {
    "zh-TW": "縮小",
    "en-US": "Zoom out",
  },
  "canvas.resetView": {
    "zh-TW": "重設檢視",
    "en-US": "Reset view",
  },
  "board.placeholder": {
    "zh-TW": "畫布尚未實作。這裡之後會是無限畫布。",
    "en-US": "Canvas not implemented yet. The infinite canvas lands here.",
  },
} satisfies Record<string, Record<ProvidedLang, string>>;
