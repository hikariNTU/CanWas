import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: RootLayout,
});

/**
 * No chrome here. The board screen is immersive — its canvas reaches every edge
 * and all controls float over it — so any shared header would have to be
 * hidden on the one screen that matters. Home renders its own.
 */
function RootLayout() {
  return (
    <div className="h-full bg-neutral-950 text-neutral-100">
      <Outlet />
    </div>
  );
}
