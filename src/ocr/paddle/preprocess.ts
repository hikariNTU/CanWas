/**
 * Turning pixels into the tensors the two graphs expect.
 *
 * Both preprocessing recipes come from the models' own `inference.yml`, not
 * from a port: detection normalizes with the ImageNet statistics, recognition
 * maps to [-1, 1] and pins the height at 48.
 */

/** Detection's long edge, from `DetResizeForTest: resize_long: 960`. */
const DETECTION_LONG_EDGE = 960;
/** The det graph downsamples by 32, so both sides must be a multiple of it. */
const STRIDE = 32;
/**
 * Screenshots are the case this app exists for, and their text is 12-16px when
 * engines want around 30px of cap height. Upscaling is the single biggest
 * accuracy lever available, so a small image is enlarged towards the long edge
 * rather than left alone — but only so far, since past 3x the interpolation is
 * inventing detail and only costs time.
 */
const MAX_UPSCALE = 3;

const DETECTION_MEAN = [0.485, 0.456, 0.406] as const;
const DETECTION_STD = [0.229, 0.224, 0.225] as const;

/** Recognition's input height, pinned by the graph. v3 and v4 used 32. */
export const RECOGNITION_HEIGHT = 48;
/** Beyond this a line is split rather than squeezed into one tensor. */
export const MAX_RECOGNITION_WIDTH = 1600;

export interface DetectionInput {
  data: Float32Array;
  width: number;
  height: number;
  /** Multiply a detection-space coordinate by this to get asset space. */
  inverseScale: number;
}

function createContext(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("OffscreenCanvas 2d context unavailable");
  }
  return context;
}

export function prepareDetectionInput(bitmap: ImageBitmap): DetectionInput {
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(MAX_UPSCALE, DETECTION_LONG_EDGE / longEdge);
  // Rounded up to the stride so the graph's own downsampling divides evenly;
  // rounding down instead would crop the last few pixels of the image.
  const width = Math.max(
    STRIDE,
    Math.ceil((bitmap.width * scale) / STRIDE) * STRIDE,
  );
  const height = Math.max(
    STRIDE,
    Math.ceil((bitmap.height * scale) / STRIDE) * STRIDE,
  );

  const context = createContext(width, height);
  context.imageSmoothingQuality = "high";
  // Drawn at the scaled size rather than stretched to the padded size: the
  // padding is dead space the network sees as black, which is cheaper than
  // distorting the aspect ratio the boxes will be measured in.
  const drawnWidth = Math.round(bitmap.width * scale);
  const drawnHeight = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, 0, 0, drawnWidth, drawnHeight);
  const { data } = context.getImageData(0, 0, width, height);

  const plane = width * height;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel++) {
      tensor[channel * plane + i] =
        (data[offset + channel] / 255 - DETECTION_MEAN[channel]) /
        DETECTION_STD[channel];
    }
  }

  return { data: tensor, width, height, inverseScale: 1 / scale };
}

export interface Crop {
  data: Float32Array;
  width: number;
}

/**
 * One detected box, cropped from the original image and scaled to the
 * recognizer's height.
 *
 * Cropped from the source bitmap rather than from the detection canvas: the
 * detection canvas may have been downscaled to fit 960px, and recognition wants
 * every pixel the image actually has.
 */
export function cropForRecognition(
  bitmap: ImageBitmap,
  box: { x0: number; y0: number; x1: number; y1: number },
): Crop {
  const sourceWidth = Math.max(1, Math.round(box.x1 - box.x0));
  const sourceHeight = Math.max(1, Math.round(box.y1 - box.y0));
  const aspect = sourceWidth / sourceHeight;
  const width = Math.min(
    MAX_RECOGNITION_WIDTH,
    Math.max(1, Math.round(RECOGNITION_HEIGHT * aspect)),
  );

  const context = createContext(width, RECOGNITION_HEIGHT);
  context.imageSmoothingQuality = "high";
  context.drawImage(
    bitmap,
    Math.round(box.x0),
    Math.round(box.y0),
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    RECOGNITION_HEIGHT,
  );
  const { data } = context.getImageData(0, 0, width, RECOGNITION_HEIGHT);

  const plane = width * RECOGNITION_HEIGHT;
  const tensor = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel++) {
      // (x / 255 - 0.5) / 0.5, the recognizer's normalization.
      tensor[channel * plane + i] = data[offset + channel] / 127.5 - 1;
    }
  }
  return { data: tensor, width };
}

/**
 * Packs crops into one batch tensor, padding the narrow ones with zeros.
 *
 * Zero is the padding value because the normalization above centres on it, so
 * padding reads as mid-grey rather than as a black bar the recognizer might try
 * to read.
 */
export function packBatch(crops: readonly Crop[]): {
  data: Float32Array;
  width: number;
} {
  const width = Math.max(...crops.map((crop) => crop.width));
  const plane = width * RECOGNITION_HEIGHT;
  const data = new Float32Array(crops.length * 3 * plane);
  crops.forEach((crop, index) => {
    const cropPlane = crop.width * RECOGNITION_HEIGHT;
    for (let channel = 0; channel < 3; channel++) {
      for (let row = 0; row < RECOGNITION_HEIGHT; row++) {
        const from = channel * cropPlane + row * crop.width;
        const to = index * 3 * plane + channel * plane + row * width;
        data.set(crop.data.subarray(from, from + crop.width), to);
      }
    }
  });
  return { data, width };
}
