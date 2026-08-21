import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useState } from "react";

import {
  DETECTION_MODEL,
  MODEL_BYTES,
  MODEL_LABEL,
  RECOGNITION_MODEL,
} from "@/ocr/paddle/models";
import {
  clearModels,
  storageBreakdown,
  type StorageBreakdown,
} from "@/storage/db";
import { useTranslation, type TranslationsKey } from "@/translations";
import { Icon } from "@/ui/icon";
import { PanelButton } from "@/ui/panel";

/**
 * What this build is and what it has put on the user's disk.
 *
 * Worth a panel because this app quietly downloads 31 MB of weights and keeps
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

/**
 * What this device says about its own edges.
 *
 * Here because the answers differ per device and per install, and none of them
 * can be reached from a machine that is not the one having the problem: a phone
 * has no developer tools, and an emulator reports zeroes for all of it. Written
 * as one dense line rather than five rows — it is a reading to relay, not a
 * setting to understand (D98).
 *
 * `box` is where those edges land on the glass and `scr` is the screen they
 * land on, which is what separates an inset that is too large from a viewport
 * that is too short.
 *
 * `off` is where the chrome layer's edges actually landed, `env` is what the
 * browser reports before any floor or gutter is applied, and the two flags are
 * the conditions the floor is gated on. `off` under `env` at the bottom is the
 * 12px gutter being absorbed (D101); `std no` on an installed app is the floor
 * never running.
 */
function measureEdges(): string {
  const layer = document.querySelector("[data-testid=chrome-layer]");
  const offsets = layer ? getComputedStyle(layer) : null;
  // A throwaway element is the only way to read an `env()` the stylesheet has
  // not already been asked to apply somewhere.
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;visibility:hidden;height:env(safe-area-inset-top);width:env(safe-area-inset-bottom)";
  document.body.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const box = layer?.getBoundingClientRect();
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const callout = CSS.supports("-webkit-touch-callout", "none");
  const round = (value: string | number) =>
    Math.round(parseFloat(String(value)));

  return [
    // The layer's own offsets, which is where the insets live since D99 —
    // this row read `padding` until padding turned out to be the bug.
    `off ${round(offsets?.top ?? 0)}/${round(offsets?.bottom ?? 0)}`,
    `env ${Math.round(rect.height)}/${Math.round(rect.width)}`,
    `std ${standalone ? "yes" : "no"}`,
    `cal ${callout ? "yes" : "no"}`,
    `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)}`,
    // Where the layer's edges actually are on the glass, against the screen
    // itself. A layout viewport shorter than the screen would leave everything
    // anchored to its bottom floating above the real edge, and no reading of
    // the insets alone can tell that apart from an inset that is too large.
    `scr ${Math.round(window.screen.width)}×${Math.round(window.screen.height)}`,
    `box ${Math.round(box?.top ?? 0)}→${Math.round(box?.bottom ?? 0)}`,
  ].join(" · ");
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
  // Measured when the panel opens rather than at render: it depends on layout,
  // and it changes when the phone is rotated or the app is reinstalled.
  const [edges, setEdges] = useState("");

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
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Measured from the event rather than from an effect: the chrome layer
        // is already laid out, and nothing here is synchronising with an
        // external system that could change while the panel is shut.
        if (next) {
          setEdges(measureEdges());
        }
      }}
    >
      <Popover.Trigger
        data-testid="about-open"
        aria-label={t("about.open")}
        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full glass glass-hover text-neutral-400 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500 pointer-coarse:h-11 pointer-coarse:w-11"
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
            className="w-80 rounded-lg glass-strong p-3 text-sm focus:outline-none"
          >
            <Popover.Title className="mb-2 font-bold text-neutral-100">
              {t("about.title")}
            </Popover.Title>

            <Row label="about.version">v{__BUILD_VERSION__}</Row>
            <Row label="about.build">
              {__BUILD_COMMIT__}
              <span className="ml-2 text-neutral-500">
                {__BUILD_TIME__.slice(0, 10)}
              </span>
            </Row>
            <Row label="about.display" testId="about-display">
              <span className="text-[11px] break-all">{edges}</span>
            </Row>
            <Row label="about.engine">{MODEL_LABEL}</Row>
            <Row label="about.runtime">onnxruntime-web {__ORT_VERSION__}</Row>
            <Row label="about.weights">
              {formatBytes(MODEL_BYTES)}
              <span className="ml-2 text-neutral-500">
                {t(weightsCached ? "about.cached" : "about.notCached")}
              </span>
            </Row>

            <div className="mt-2 mb-1 border-t border-white/10 pt-2 font-bold text-neutral-100">
              {t("about.storage")}
            </div>
            <Row label="about.images" testId="about-images">
              {formatBytes(storage?.assetBytes ?? 0)}
              <span className="ml-2 text-neutral-500">
                &times;{storage?.assetCount ?? 0}
              </span>
            </Row>
            {/* What sync would actually send, which is not what the images
                cost here: the originals stay on this device. */}
            <Row label="about.compressed" testId="about-compressed">
              {formatBytes(storage?.webpBytes ?? 0)}
              {(storage?.assetBytes ?? 0) > 0 &&
                (storage?.webpBytes ?? 0) > 0 && (
                  <span className="ml-2 text-neutral-500">
                    &minus;
                    {Math.round(
                      (1 - storage!.webpBytes / storage!.assetBytes) * 100,
                    )}
                    %
                  </span>
                )}
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
              <PanelButton
                data-testid="about-clear-models"
                icon="delete_sweep"
                className="mt-3"
                onClick={() => {
                  void clearModels().then(refresh);
                }}
              >
                {t("about.clearModels")}
              </PanelButton>
            )}

            <p className="mt-2 text-xs text-neutral-600">
              {DETECTION_MODEL.id} + {RECOGNITION_MODEL.id}
            </p>

            {/* Real pages, not routes: these are static HTML built alongside
                the app (D67), so they open without it and can be linked to
                from outside. `BASE_URL` because the site lives under a
                subpath, and a new tab because leaving the board to read a
                licence is not what anyone means to do. */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-2 text-xs">
              {(
                [
                  ["about.overview", "about.html"],
                  ["about.privacy", "privacy.html"],
                  ["about.support", "support.html"],
                  ["about.licenses", "licenses.html"],
                ] as const
              ).map(([label, file]) => (
                <a
                  key={file}
                  href={`${import.meta.env.BASE_URL}${file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-neutral-400 underline-offset-2 transition-colors hover:text-neutral-100 hover:underline focus-visible:outline-2 focus-visible:outline-sky-500"
                >
                  {t(label)}
                </a>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
