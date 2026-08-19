import { createRootRoute, Outlet } from "@tanstack/react-router";

import { LanguageMenu } from "@/components/language-menu";
import { useTranslation } from "@/translations";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-2">
        <span className="text-sm font-semibold tracking-tight">
          {t("app.name")}
        </span>
        <LanguageMenu />
      </header>
      <main className="min-h-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
