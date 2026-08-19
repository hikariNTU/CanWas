# OCR research

Measured 2026-08-19. Captured so the engine choice does not have to be
re-litigated when [step 9](roadmap.md) arrives. Nothing here is installed yet —
see [D3](decisions.md#d3--ocr-deferred-behind-an-interface-mock-ships-first).

## Candidate engines

| Package | Weekly downloads | Maintainers | License | Note |
| --- | --- | --- | --- | --- |
| `onnxruntime-web` 1.27.0 | 3,549,710 | 4 (Microsoft) | MIT | runtime only |
| `tesseract.js` 7.0.0 | 1,934,559 | 4 | Apache-2.0 | weak zh-TW |
| `ppu-paddle-ocr` 6.4.0 | 10,036 | 1 | MIT | 274 KB wrapper |
| `@gutenye/ocr-browser` 1.4.8 | 2,957 | 1 | MIT | 18 KB wrapper |

## Paddle.js is dead — do not use it

The official PaddlePaddle JS repo looks alive (1.1k stars, never archived) but
is not:

```
default branch last commit   2022-11-17  (README edit)
last real code commit        2022-09-02
open issues                  109
@paddlejs-models/ocr 1.2.4   published 2023-11-16
@paddlejs/paddlejs-core      published 2023-04-26
@paddlejs/backend-webgl      published 2022-10-18
```

It ships PP-OCRv2/v3-era models on a WebGL backend with its own weight format,
converter, and op registry. Four years cold with no deprecation notice.

## Weight sizes

PP-OCRv5, ONNX:

| Variant | det | rec | dict | total |
| --- | --- | --- | --- | --- |
| **mobile** | 4.5 MB | 15.8 MB | 72 KB | **20.4 MB** |
| server | 83.7 MB | 80.3 MB | 72 KB | 164.0 MB |
| en-only mobile `.ort` | 4.5 MB | 7.6 MB | 4.4 KB | 12.1 MB |
| en-only int8 `.ort` | 4.5 MB | 6.8 MB | 4.4 KB | 11.3 MB |

PP-OCRv6 also exists (`.ort` only, accuracy unverified):

| Variant | det | rec | total |
| --- | --- | --- | --- |
| tiny | 1.8 MB | 4.3 MB | 6.1 MB |
| small | 9.5 MB | 20.3 MB | 29.8 MB |
| medium | 59.3 MB | 73.1 MB | 132.4 MB |

For comparison, Tesseract's `chi_tra` traineddata alone is ~20 MB for worse CJK.
Going PaddleOCR costs nothing in bytes.

`.ort` is ONNX Runtime's pre-optimized serialization — smaller and faster to load,
but version-locked to the runtime build. Prefer `.onnx` unless load time bites.

## Provenance check

Converted ONNX from the `ppu-paddle-ocr-models` repo, compared against official
`PaddlePaddle/*` Hugging Face `.pdiparams`:

| Model | ppu ONNX | official HF | delta |
| --- | --- | --- | --- |
| v5 mobile det | 4637 KB | 4582 KB | +1.2% |
| v5 mobile rec | 16171 KB | 16072 KB | +0.6% |
| v5 server rec | 82203 KB | 82412 KB | −0.3% |

Straight `paddle2onnx` conversions of Baidu's official weights, not retrained.
The weights are trustworthy independently of the wrapper package. They can also
be converted from Hugging Face directly, skipping that host entirely.

Verified hashes of what was measured:

```
det.onnx  d7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924
rec.onnx  d253c3cbee6e507828a5271a30ab0ec8ae7c2a99d0cc8e6f844fe380809d22b3
```

## Graph shapes (PP-OCRv5 mobile)

```
det.onnx   4.53 MB   opset 14   664 nodes
  IN   x            float32  [N, 3, H, W]      dynamic H/W
  OUT  fetch_name_0 float32  [N, 1, H, W]      single-channel probability map

rec.onnx  15.79 MB   opset  9   344 nodes
  IN   x            float32  [N, 3, 48, W]     height PINNED at 48
  OUT  fetch_name_0 float32  [N, T, 18385]     CTC logits
```

Consequences for the pipeline that must be written:

- det output is one probability channel → DBNet postprocess: binarize, find
  contours, unclip. No anchors, no NMS.
- rec input height is fixed at 48 (v3/v4 used 32). Crops resize to h=48, free
  width. Batch dim is dynamic, so lines can be batched.
- **18385 output classes == 18385 dict entries exactly.** `ppocrv5_dict.txt` is
  the pre-baked final character list with the space char already appended, so
  indices map 1:1 with no `+1` offset — the usual PaddleOCR footgun does not
  apply. Confirm the blank index empirically on first run: index 0 is `　`
  and index 1 is the empty string, so it is one of those two.
- Both opsets are within `onnxruntime-web` 1.27 support.

## Preprocessing

Common advice to grayscale and threshold is close to worthless here — both
engines binarize internally. For screenshots specifically:

1. **Upscale 2–3x.** Screenshot text is 12–16 px; engines want ~30 px cap height.
   Single biggest accuracy lever.
2. `OffscreenCanvas.drawImage` does the resize. No Jimp, no OpenCV.js.

## Dead ends

- Chrome Shape Detection `TextDetector` — never shipped stable.
- macOS/iOS Safari Live Text already does this natively on `<img>`, for free. Worth
  measuring against as a baseline, not something to build on.
