import { useId, useRef } from "react";

import { useTranslation } from "@/translations";
import { Icon } from "@/ui/icon";

/**
 * The third way an image gets onto a board, after paste and drop.
 *
 * Neither of the other two exists on a phone: there is no drag source, and iOS
 * gives a web page no usable paste gesture. Without this the app is a viewer on
 * every touch device. It is shown everywhere rather than behind a media query,
 * because "add a picture" is not a worse idea with a keyboard attached, and a
 * control that only some people can see is a control nobody documents.
 *
 * `accept="image/*"` is what makes the phone offer the camera and the photo
 * library rather than a file tree.
 */
export function AddImage({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) {
            onFiles(files);
          }
          // Cleared so picking the same file twice in a row still fires a
          // change event the second time.
          event.target.value = "";
        }}
      />
      <button
        type="button"
        data-testid="add-image"
        aria-label={t("image.add")}
        title={t("image.add")}
        onClick={() => inputRef.current?.click()}
        className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900/80 text-neutral-300 shadow-lg backdrop-blur transition-colors hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500"
      >
        <Icon name="add_photo_alternate" size={22} />
      </button>
    </>
  );
}
