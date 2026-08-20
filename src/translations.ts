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

/**
 * Translation outside React, for route loaders and other non-component code.
 * Reads the stored preference directly rather than the atom.
 */
export function translate(key: TranslationsKey): string {
  return translations[key][getPreferredLang()];
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
  "ocr.queued": {
    "zh-TW": "等待辨識",
    "en-US": "Waiting to read",
  },
  "ocr.running": {
    "zh-TW": "辨識中",
    "en-US": "Reading",
  },
  "ocr.downloading": {
    "zh-TW": "下載辨識模型",
    "en-US": "Downloading the reader",
  },
  "ocr.failed": {
    "zh-TW": "辨識失敗",
    "en-US": "Could not read",
  },
  "ocr.done": {
    "zh-TW": "文字可選取",
    "en-US": "Text is selectable",
  },
  "about.open": {
    "zh-TW": "關於這個版本",
    "en-US": "About this build",
  },
  "about.title": {
    "zh-TW": "關於",
    "en-US": "About",
  },
  "about.build": {
    "zh-TW": "版本",
    "en-US": "Build",
  },
  "about.engine": {
    "zh-TW": "辨識引擎",
    "en-US": "Recognizer",
  },
  "about.runtime": {
    "zh-TW": "執行環境",
    "en-US": "Runtime",
  },
  "about.weights": {
    "zh-TW": "模型權重",
    "en-US": "Weights",
  },
  "about.storage": {
    "zh-TW": "本機儲存",
    "en-US": "On this device",
  },
  "about.images": {
    "zh-TW": "圖片",
    "en-US": "Images",
  },
  "about.boards": {
    "zh-TW": "畫板",
    "en-US": "Boards",
  },
  "about.total": {
    "zh-TW": "瀏覽器統計",
    "en-US": "Browser total",
  },
  "about.cached": {
    "zh-TW": "已快取",
    "en-US": "cached",
  },
  "about.notCached": {
    "zh-TW": "尚未下載",
    "en-US": "not downloaded yet",
  },
  "about.persisted": {
    "zh-TW": "已設為持久儲存",
    "en-US": "Storage is persistent",
  },
  "about.evictable": {
    "zh-TW": "空間不足時可能被清除",
    "en-US": "Evictable under disk pressure",
  },
  "about.clearModels": {
    "zh-TW": "清除模型快取",
    "en-US": "Clear the cached weights",
  },
  "image.add": {
    "zh-TW": "加入圖片",
    "en-US": "Add an image",
  },
  "about.compressed": {
    "zh-TW": "壓縮後（同步用）",
    "en-US": "WebP for sync",
  },
  "sync.title": {
    "zh-TW": "Google 雲端硬碟",
    "en-US": "Google Drive",
  },
  "sync.reconnect": {
    "zh-TW": "重新連線",
    "en-US": "Reconnect",
  },
  "sync.expired": {
    "zh-TW": "連線階段已過期，請重新連線",
    "en-US": "The Drive session has expired. Reconnect to keep syncing.",
  },
  "sync.expiredWhy": {
    "zh-TW": "Google 的權杖只有一小時，且必須由點擊取得。",
    "en-US":
      "Google tokens last an hour and can only be obtained from a click.",
  },
  "sync.lastConnected": {
    "zh-TW": "上次連線的帳戶",
    "en-US": "Last connected",
  },
  "sync.grantedTo": {
    "zh-TW": "已授權的帳戶",
    "en-US": "Granted by",
  },
  "sync.accountUnknown": {
    "zh-TW": "帳戶名稱無法取得",
    "en-US": "Account name unavailable",
  },
  "sync.now": {
    "zh-TW": "立即同步",
    "en-US": "Sync now",
  },
  "sync.signOut": {
    "zh-TW": "登出",
    "en-US": "Sign out",
  },
  "sync.connecting": {
    "zh-TW": "連線中…",
    "en-US": "Connecting…",
  },
  "sync.unconfigured": {
    "zh-TW": "這個版本尚未設定 Google 用戶端 ID",
    "en-US": "This build has no Google client id",
  },
  "sync.fake": {
    "zh-TW": "同步至本機測試遠端",
    "en-US": "Syncing to the local fake remote",
  },
  "sync.syncing": {
    "zh-TW": "同步中…",
    "en-US": "Syncing…",
  },
  "sync.idle": {
    "zh-TW": "已同步",
    "en-US": "Synced",
  },
  "sync.failed": {
    "zh-TW": "同步失敗",
    "en-US": "Sync failed",
  },
  "sync.off": {
    "zh-TW": "尚未同步",
    "en-US": "Not syncing",
  },
  "sync.connect": {
    "zh-TW": "連結 Google 雲端硬碟",
    "en-US": "Connect Google Drive",
  },
  "asset.missing": {
    "zh-TW": "圖片尚未同步到這台裝置",
    "en-US": "This image has not reached this device yet",
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
  "board.delete": {
    "zh-TW": "刪除此畫板",
    "en-US": "Delete board",
  },
  "board.rename": {
    "zh-TW": "重新命名畫板",
    "en-US": "Rename board",
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
  "text.size": {
    "zh-TW": "文字大小",
    "en-US": "Text size",
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
