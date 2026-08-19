import { Menu } from "@base-ui/react/menu";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import {
  ArrowLeftIcon,
  CheckIcon,
  CrosshairIcon,
  MenuIcon,
} from "lucide-react";

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
  "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-neutral-300 select-none data-[highlighted]:bg-neutral-800 data-[highlighted]:text-neutral-100";

/** The board screen's only persistent chrome besides the title and controls. */
export function BoardMenu({ onResetView }: { onResetView: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [lang, setLang] = useAtom(currentLangAtom);

  return (
    <Menu.Root>
      <Menu.Trigger
        data-testid="board-menu"
        aria-label={t("menu.open")}
        className="pointer-events-auto grid h-9 w-9 place-items-center rounded-lg border border-neutral-800 bg-neutral-900/90 text-neutral-400 shadow-lg backdrop-blur transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        <MenuIcon size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start">
          <Menu.Popup className="min-w-52 rounded-lg border border-neutral-800 bg-neutral-900/95 p-1 text-sm shadow-xl backdrop-blur">
            <Menu.Item
              data-testid="menu-back"
              className={itemClass}
              onClick={() => void navigate({ to: "/" })}
            >
              <ArrowLeftIcon size={16} className="shrink-0 text-neutral-500" />
              {t("board.back")}
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={onResetView}>
              <CrosshairIcon size={16} className="shrink-0 text-neutral-500" />
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
                  {/* Fixed-width gutter so labels align whether or not the
                      indicator is showing. */}
                  <span className="grid w-4 shrink-0 place-items-center">
                    <Menu.RadioItemIndicator>
                      <CheckIcon size={16} className="text-sky-400" />
                    </Menu.RadioItemIndicator>
                  </span>
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
