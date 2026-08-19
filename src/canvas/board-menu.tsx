import { Menu } from "@base-ui/react/menu";
import { useNavigate } from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";

import { boardsMetaAtom } from "@/storage/boards-atom";
import {
  currentLangAtom,
  useTranslation,
  type ProvidedLang,
} from "@/translations";

const languages: { value: ProvidedLang; label: string }[] = [
  { value: "en-US", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

const itemClass =
  "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-neutral-300 select-none data-[highlighted]:bg-neutral-800 data-[highlighted]:text-neutral-100";

/**
 * The board screen's only persistent chrome. Everything that would otherwise
 * need a header bar lives in here, so the canvas reaches every edge.
 */
export function BoardMenu({
  boardId,
  onResetView,
}: {
  boardId: string;
  onResetView: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [lang, setLang] = useAtom(currentLangAtom);
  const meta = useAtomValue(boardsMetaAtom)[boardId];

  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="board-menu"
        aria-label={t("menu.open")}
        className="pointer-events-auto flex h-9 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/90 px-2.5 text-sm text-neutral-300 shadow-lg backdrop-blur transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        <span aria-hidden className="text-base leading-none">
          ☰
        </span>
        <span
          data-testid="board-name"
          className="max-w-40 truncate text-xs text-neutral-500"
        >
          {meta?.name ?? boardId}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start">
          <Menu.Popup className="min-w-52 rounded-lg border border-neutral-800 bg-neutral-900/95 p-1 text-sm shadow-xl backdrop-blur">
            <Menu.Item
              data-testid="menu-back"
              className={itemClass}
              onClick={() => void navigate({ to: "/" })}
            >
              <Slot>←</Slot>
              {t("board.back")}
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={onResetView}>
              <Slot>⌖</Slot>
              {t("canvas.resetView")}
            </Menu.Item>

            <Menu.Separator className="my-1 h-px bg-neutral-800" />
            <Menu.RadioGroup
              value={lang}
              onValueChange={(value) => setLang(value as ProvidedLang)}
            >
              {/* GroupLabel reads its group from context, so it must be nested
                  inside the RadioGroup rather than sitting beside it. */}
              <Menu.GroupLabel className="px-2 py-1 text-xs text-neutral-500">
                {t("lang.label")}
              </Menu.GroupLabel>
              {languages.map((language) => (
                <Menu.RadioItem
                  key={language.value}
                  value={language.value}
                  className={itemClass}
                >
                  <Slot>
                    <Menu.RadioItemIndicator className="text-[0.5rem] text-sky-400">
                      ●
                    </Menu.RadioItemIndicator>
                  </Slot>
                  {language.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Fixed-width gutter so labels align whether or not their icon is showing. */
function Slot({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid w-3 shrink-0 place-items-center text-neutral-500">
      {children}
    </span>
  );
}
