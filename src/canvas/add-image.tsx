import clsx from "clsx";
import { useId, useRef } from "react";

import { useTranslation } from "@/translations";
import { Icon } from "@/ui/icon";
import { Tip } from "@/ui/tooltip";

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
export function AddImage({
  onFiles,
  className,
}: {
  onFiles: (files: File[]) => void;
  /**
   * Replaces the resting pill. On touch this button sits inside the mode bar
   * rather than alone in a corner, and a glass pill nested in a glass bar is
   * two surfaces where the design has one.
   */
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Picker
      onFiles={onFiles}
      className={className}
      testId="add-image"
      label={t("image.add")}
      icon="add_photo_alternate"
      multiple
    />
  );
}

/**
 * The camera, as its own button rather than an option inside the picker above.
 *
 * iOS puts "Take Photo" in the sheet that `accept="image/*"` opens, so there
 * the two buttons are one tap versus two. Android Chrome does not: its picker
 * is the photo library, and reaching the camera from it is a trip through the
 * system file app that most people do not find. `capture="environment"` is the
 * one attribute that makes the browser hand the request straight to the rear
 * camera, and it is why this cannot just be the same input with a different
 * label — `capture` changes what a picker *is*, so an input carrying it can
 * never also offer the library.
 *
 * Touch only. On a desktop browser `capture` is ignored and the button opens a
 * second file dialog identical to the first, which is a control that lies.
 *
 * No `multiple`: a camera returns one frame, and the attribute is ignored
 * alongside `capture` anyway.
 */
export function TakePhoto({
  onFiles,
  className,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <Picker
      onFiles={onFiles}
      className={className}
      testId="take-photo"
      label={t("image.camera")}
      icon="photo_camera"
      capture="environment"
    />
  );
}

/** The shared body: one hidden input, one button that clicks it. */
function Picker({
  onFiles,
  className,
  testId,
  label,
  icon,
  multiple,
  capture,
}: {
  onFiles: (files: File[]) => void;
  className?: string;
  testId: string;
  label: string;
  icon: string;
  multiple?: boolean;
  capture?: "environment";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        data-testid={`${testId}-input`}
        type="file"
        accept="image/*"
        multiple={multiple}
        capture={capture}
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
      <Tip label={label}>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          onClick={() => inputRef.current?.click()}
          className={clsx(
            "pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full text-neutral-300 transition-colors hover:bg-white/10 hover:text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-500",
            className ?? "glass",
          )}
        >
          <Icon name={icon} size={22} />
        </button>
      </Tip>
    </>
  );
}
