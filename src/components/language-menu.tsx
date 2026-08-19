import { Menu } from "@base-ui/react/menu";
import { CheckIcon, LanguagesIcon } from "lucide-react";
import { useAtom } from "jotai";

import {
  currentLangAtom,
  useTranslation,
  type ProvidedLang,
} from "@/translations";

const options: { value: ProvidedLang; label: string }[] = [
  { value: "en-US", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
];

export function LanguageMenu() {
  const [lang, setLang] = useAtom(currentLangAtom);
  const { t } = useTranslation();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("lang.label")}
        className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-300 transition-colors duration-150 hover:bg-neutral-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
      >
        <LanguagesIcon size={16} className="shrink-0 text-neutral-500" />
        {options.find((o) => o.value === lang)?.label}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end">
          <Menu.Popup className="min-w-36 rounded-lg border border-neutral-800 bg-neutral-900/95 p-1 text-sm shadow-xl backdrop-blur">
            <Menu.RadioGroup
              value={lang}
              onValueChange={(value) => setLang(value as ProvidedLang)}
            >
              {options.map((option) => (
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-neutral-300 select-none data-[highlighted]:bg-neutral-800 data-[highlighted]:text-neutral-100"
                >
                  <span className="grid w-4 shrink-0 place-items-center">
                    <Menu.RadioItemIndicator>
                      <CheckIcon size={16} className="text-sky-400" />
                    </Menu.RadioItemIndicator>
                  </span>
                  {option.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
