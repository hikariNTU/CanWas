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
  "about.version": {
    "zh-TW": "版本",
    "en-US": "Version",
  },
  "about.build": {
    "zh-TW": "建置",
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
  "image.camera": {
    "zh-TW": "拍照",
    "en-US": "Take a photo",
  },
  "about.display": {
    "zh-TW": "螢幕邊界",
    "en-US": "Edges",
  },
  "image.failed": {
    "zh-TW": "圖片無法加入",
    "en-US": "That image could not be added",
  },
  "image.dismiss": {
    "zh-TW": "關閉訊息",
    "en-US": "Dismiss",
  },
  "about.compressed": {
    "zh-TW": "壓縮後（同步用）",
    "en-US": "WebP for sync",
  },
  "node.copy": {
    "zh-TW": "複製",
    "en-US": "Copy",
  },
  "node.copyText": {
    "zh-TW": "複製文字",
    "en-US": "Copy text",
  },
  "node.read": {
    "zh-TW": "閱讀文字",
    "en-US": "Read text",
  },
  "node.doubleClick": {
    "zh-TW": "點兩下",
    "en-US": "Double-click",
  },
  "node.front": {
    "zh-TW": "移至最上層",
    "en-US": "Bring to front",
  },
  "node.back": {
    "zh-TW": "移至最下層",
    "en-US": "Send to back",
  },
  "node.openInDrive": {
    "zh-TW": "在雲端硬碟開啟",
    "en-US": "Open in Drive",
  },
  "node.delete": {
    "zh-TW": "刪除",
    "en-US": "Delete",
  },
  "about.overview": {
    "zh-TW": "關於 CanWas",
    "en-US": "About CanWas",
  },
  "about.privacy": {
    "zh-TW": "隱私權",
    "en-US": "Privacy",
  },
  "about.support": {
    "zh-TW": "支援",
    "en-US": "Support",
  },
  "about.licenses": {
    "zh-TW": "授權",
    "en-US": "Licenses",
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
  "sync.reconnectAs": {
    "zh-TW": "以此帳戶重新連線",
    "en-US": "Reconnect as",
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
  "guard.title": {
    "zh-TW": "這個板子還沒讀到雲端的版本",
    "en-US": "This board has not read its remote copy",
  },
  "guard.body": {
    "zh-TW":
      "此板子曾同步過，但目前連不上雲端硬碟。現在編輯的內容，會是在沒看過其他裝置修改的情況下做出的。",
    "en-US":
      "This board syncs, but Drive cannot be reached right now. Anything you change now is changed without having seen what your other devices did.",
  },
  "guard.reconnect": {
    "zh-TW": "重新連線並同步",
    "en-US": "Reconnect and sync",
  },
  "guard.anyway": {
    "zh-TW": "仍要編輯",
    "en-US": "Edit anyway",
  },
  "guard.held": {
    "zh-TW": "你剛才的操作會保留，選擇後就會套用，或是直接放棄。",
    "en-US":
      "Your last action is being held. It lands as soon as you choose, or you can discard it.",
  },
  "guard.discard": {
    "zh-TW": "放棄這個操作",
    "en-US": "Discard the edit",
  },
  "guard.syncing": {
    "zh-TW": "同步中…",
    "en-US": "Syncing…",
  },
  "sync.now": {
    "zh-TW": "立即同步",
    "en-US": "Sync now",
  },
  "sync.signOut": {
    "zh-TW": "登出",
    "en-US": "Sign out",
  },
  "sync.revokeAccess": {
    "zh-TW": "在 Google 帳戶移除授權",
    "en-US": "Remove access in your Google Account",
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
  "canvas.modePan": {
    "zh-TW": "平移",
    "en-US": "Pan",
  },
  "canvas.modeSelect": {
    "zh-TW": "選取",
    "en-US": "Select",
  },
  "canvas.deleteSelection": {
    "zh-TW": "刪除所選",
    "en-US": "Delete selection",
  },
  "pwa.updateReady": {
    "zh-TW": "有新版本",
    "en-US": "New version available",
  },
  "pwa.reload": {
    "zh-TW": "重新載入",
    "en-US": "Reload",
  },
  "pwa.dismiss": {
    "zh-TW": "稍後再說",
    "en-US": "Later",
  },
  "board.placeholder": {
    "zh-TW": "畫布尚未實作。這裡之後會是無限畫布。",
    "en-US": "Canvas not implemented yet. The infinite canvas lands here.",
  },
} satisfies Record<string, Record<ProvidedLang, string>>;
