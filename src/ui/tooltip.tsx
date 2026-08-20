import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

/**
 * A tooltip, for the floating chrome.
 *
 * The native `title` attribute was doing this job and doing it badly: the
 * browser draws it in its own style at its own speed, in the OS's colours
 * rather than the app's, and it cannot be seen at all on a touch screen. It is
 * also the only piece of this interface that looked like it belonged to a
 * different program, which on a canvas made of floating glass panels is exactly
 * the thing that gets noticed.
 *
 * Wraps whatever it is given rather than rendering a wrapper element, so the
 * button keeps its own layout: `render` hands the trigger's behaviour to the
 * child instead of nesting one button inside another.
 */
export function Tip({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          {/* Base UI does not put the role on the popup itself, and without it
              a screen reader is handed a box of text with no relationship to
              the control it describes. */}
          <Tooltip.Popup
            role="tooltip"
            data-testid="tooltip"
            className="glass-strong pointer-events-none max-w-64 rounded-md px-2 py-1 text-xs text-neutral-200"
          >
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/**
 * Shared timing for every tooltip on the page.
 *
 * Grouped so that reading one and moving to the next does not mean waiting
 * again: the delay is for the pointer passing *through* a control, not for the
 * one that has already stopped.
 */
export function TipProvider({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delay={400} closeDelay={100}>
      {children}
    </Tooltip.Provider>
  );
}
