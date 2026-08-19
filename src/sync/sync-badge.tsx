import { useAtomValue } from "jotai";

import { Icon } from "@/ui/icon";
import { syncStatusAtom } from "@/sync/use-sync";
import { useTranslation } from "@/translations";

/**
 * A one-glance answer to "is my work anywhere else yet".
 *
 * Deliberately not silent when it is off. A board that looks backed up and is
 * not is only discovered on the day it matters, so the resting state says "not
 * syncing" rather than showing nothing at all.
 */
export function SyncBadge() {
  const status = useAtomValue(syncStatusAtom);
  const { t } = useTranslation();

  const label =
    status.state === "syncing"
      ? t("sync.syncing")
      : status.state === "idle"
        ? t("sync.idle")
        : status.state === "failed"
          ? t("sync.failed")
          : t("sync.off");

  return (
    <span
      data-testid="sync-badge"
      data-sync-state={status.state}
      title={status.state === "failed" ? status.message : label}
      aria-label={label}
      className={
        status.state === "failed"
          ? "pointer-events-auto grid h-8 w-8 place-items-center text-amber-400"
          : status.state === "syncing"
            ? "pointer-events-auto grid h-8 w-8 place-items-center text-sky-400"
            : status.state === "idle"
              ? "pointer-events-auto grid h-8 w-8 place-items-center text-neutral-500"
              : "hidden"
      }
    >
      <Icon name={status.state === "failed" ? "cloud_off" : "cloud_done"} />
    </span>
  );
}
