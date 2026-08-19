import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useState } from "react";

import {
  DETECTION_MODEL,
  MODEL_BYTES,
  RECOGNITION_MODEL,
} from "@/ocr/paddle/models";
import {
  clearModels,
  storageBreakdown,
  type StorageBreakdown,
} from "@/storage/db";
import { useTranslation, type TranslationsKey } from "@/translations";
import { Icon } from "@/ui/icon";

/**
 * What this build is and what it has put on the user's disk.
 *
 * Worth a panel because this app quietly downloads 21 MB of weights and keeps
 * them, alongside every image ever pasted. Somewhere that is stated plainly,
 * with a way to take the weights back, is the difference between caching and
 * helping yourself.
 */

/** Bytes as something readable, not as a number with ten digits. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function Row({
  label,
  testId,
  children,
}: {
  label: TranslationsKey;
  testId?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={testId}
      className="flex items-baseline justify-between gap-6 py-1"
    >
      <span className="text-neutral-400">{t(label)}</span>
      <span className="text-right font-mono text-neutral-200 tabular-nums">
        {children}
      </span>
    </div>
  );
}

export function About() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<StorageBreakdown | null>(null);

  const refresh = useCallback(() => {
    void storageBreakdown()
      .then(setStorage)
      .catch(() => setStorage(null));
  }, []);

  useEffect(() => {
    // Counted when the panel opens, not on a timer: these numbers only change
    // when the user does something, and nobody watches them idle.
    if (open) {
      refresh();
    }
  }, [open, refresh]);

  const weightsCached = (storage?.modelCount ?? 0) > 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid="about-open"
        aria-label={t("about.open")}
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/80 text-neutral-400 backdrop-blur transition-colors hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <Icon name="info" size={18} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="end">
          <Popover.Popup
            data-testid="about-panel"
            // The popup takes focus when it opens, and the browser's default ring
            // on a panel this size reads as an error state rather than as
            // focus. The controls inside keep their own.
            className="w-80 rounded-lg border border-neutral-800 bg-neutral-900/95 p-3 text-sm shadow-xl backdrop-blur focus:outline-none"
          >
            <Popover.Title className="mb-2 font-bold text-neutral-100">
              {t("about.title")}
            </Popover.Title>

            <Row label="about.build">
              {__BUILD_COMMIT__}
              <span className="ml-2 text-neutral-500">
                {__BUILD_TIME__.slice(0, 10)}
              </span>
            </Row>
            <Row label="about.engine">PP-OCRv5 mobile</Row>
            <Row label="about.runtime">onnxruntime-web {__ORT_VERSION__}</Row>
            <Row label="about.weights">
              {formatBytes(MODEL_BYTES)}
              <span className="ml-2 text-neutral-500">
                {t(weightsCached ? "about.cached" : "about.notCached")}
              </span>
            </Row>

            <div className="mt-2 mb-1 border-t border-neutral-800 pt-2 font-bold text-neutral-100">
              {t("about.storage")}
            </div>
            <Row label="about.images" testId="about-images">
              {formatBytes(storage?.assetBytes ?? 0)}
              <span className="ml-2 text-neutral-500">
                &times;{storage?.assetCount ?? 0}
              </span>
            </Row>
            <Row label="about.weights" testId="about-model-bytes">
              {formatBytes(storage?.modelBytes ?? 0)}
            </Row>
            <Row label="about.boards">{storage?.boardCount ?? 0}</Row>
            {/* The browser's own figure sits alongside rather than replacing
                the counts: it includes overhead the app cannot see, so the two
                never quite agree and only one of them explains anything. */}
            <Row label="about.total">
              {storage?.quotaUsed === undefined
                ? "—"
                : formatBytes(storage.quotaUsed)}
              {storage?.quota !== undefined && (
                <span className="ml-2 text-neutral-500">
                  / {formatBytes(storage.quota)}
                </span>
              )}
            </Row>

            <p className="mt-2 text-xs text-neutral-500">
              {t(storage?.persisted ? "about.persisted" : "about.evictable")}
            </p>

            {weightsCached && (
              <button
                data-testid="about-clear-models"
                className="mt-3 w-full rounded-md border border-neutral-800 px-2 py-1.5 text-neutral-300 transition-colors hover:border-neutral-700 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500"
                onClick={() => {
                  void clearModels().then(refresh);
                }}
              >
                {t("about.clearModels")}
              </button>
            )}

            <p className="mt-2 text-xs text-neutral-600">
              {DETECTION_MODEL.id} + {RECOGNITION_MODEL.id}
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
