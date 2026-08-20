import { useRegisterSW } from "virtual:pwa-register/react";

import { Icon } from "@/ui/icon";
import { useTranslation } from "@/translations";

/**
 * Registers the service worker and asks before taking the new build.
 *
 * `registerType: "prompt"` in vite.config.ts is half of the decision; this is
 * the other half. An automatic update swaps the worker and reloads, and a
 * reload during recognition throws away an initialised ONNX runtime and a
 * 31 MB set of weights — the most expensive state the app holds, and the one
 * the user waited longest for (D72).
 *
 * Top centre, away from the bottom-edge touch chrome: this appears without
 * being asked for, and it must never land under the thumb that is mid-gesture.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      data-testid="update-prompt"
      className="glass-strong fixed inset-x-0 top-3 z-50 mx-auto flex w-fit items-center gap-2 rounded-full py-1 pr-1 pl-4"
    >
      <span className="text-xs text-neutral-200">{t("pwa.updateReady")}</span>
      <button
        type="button"
        data-testid="update-reload"
        onClick={() => void updateServiceWorker(true)}
        className="h-8 rounded-full bg-sky-500 px-3 text-xs text-neutral-950 transition-colors hover:bg-sky-400"
      >
        {t("pwa.reload")}
      </button>
      <button
        type="button"
        aria-label={t("pwa.dismiss")}
        onClick={() => setNeedRefresh(false)}
        className="grid h-8 w-8 place-items-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
