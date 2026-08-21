import { useEffect, useRef } from "react";

import type { MAX_TEXT_LENGTH } from "@/board/text";
import type { TextNode as TextNodeModel } from "@/board/types";

/**
 * Text nodes lay out at automatic height: `w` is the authoritative wrap width
 * and `h` is a cached measurement. The scene's transform is a CSS `scale`,
 * which does not affect layout, so `offsetHeight` is already in world units and
 * needs no conversion.
 */
export function measureHeight(element: HTMLElement | null): number {
  return element?.offsetHeight ?? 0;
}

/**
 * Shared so that entering and leaving edit mode cannot move a single glyph.
 *
 * The transparent border is load-bearing: editing swaps in a glass field,
 * whose border would otherwise eat two pixels of content width and rewrap the
 * text the moment it was double-clicked.
 *
 * What is *not* shared is the background. `bg-transparent` lived here, and
 * since `glass` became a utility it silently won — same layer, same
 * specificity, and `.bg-transparent` is emitted after `.glass` — so the field
 * had no tint at all and white text sat on a white screenshot. The read-only
 * half is a `div`, which is transparent without being told; only the textarea
 * has a background to suppress, and glass is what replaces it.
 */
const SHARED_TEXT_STYLE =
  "w-full resize-none border border-transparent p-1 leading-snug break-words whitespace-pre-wrap";

export function TextNodeView({
  node,
  editing,
  maxLength,
  onChange,
  onFinish,
  bodyRef,
}: {
  node: TextNodeModel;
  editing: boolean;
  maxLength: typeof MAX_TEXT_LENGTH;
  onChange: (text: string) => void;
  onFinish: () => void;
  bodyRef: React.RefObject<HTMLElement | null>;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      input?.focus();
      // Caret at the end, so typing continues rather than replacing.
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }, [editing]);

  // A textarea does not grow with its content, so its height is driven from
  // the value on every render.
  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
    }
  }, [editing, node.text]);

  if (editing) {
    return (
      <textarea
        ref={(element) => {
          inputRef.current = element;
          bodyRef.current = element;
        }}
        data-testid="text-node-input"
        value={node.text}
        maxLength={maxLength}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onFinish}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onFinish();
          }
          // Backspace, Cmd+A and the bracket keys belong to the text here,
          // not to the board.
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        style={{ fontSize: node.fontSize }}
        // A surface means something: text is bare on the board and gains a
        // field only while it is being edited, the same way the board title
        // does.
        className={`${SHARED_TEXT_STYLE} rounded-lg glass text-neutral-100 outline-none`}
      />
    );
  }

  return (
    <div
      ref={bodyRef as React.RefObject<HTMLDivElement>}
      data-testid="text-node-body"
      style={{ fontSize: node.fontSize }}
      className={`${SHARED_TEXT_STYLE} pointer-events-none text-neutral-100 select-none`}
    >
      {node.text}
    </div>
  );
}
