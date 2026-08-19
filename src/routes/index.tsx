import { createFileRoute, Link } from "@tanstack/react-router";

import { useTranslation } from "@/translations";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("home.title")}
        </h1>
        <p className="mt-2 text-sm text-neutral-400">{t("app.tagline")}</p>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <p className="text-sm text-neutral-400">{t("home.empty")}</p>
        <Link
          to="/board/$boardId"
          params={{ boardId: "demo" }}
          className="mt-4 inline-block rounded-md border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 transition-colors duration-150 hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
        >
          {t("home.openDemo")}
        </Link>
      </div>
    </div>
  );
}
