import { expect, test } from "@playwright/test";

/**
 * The real recognizer, on a page-sized document.
 *
 * Every other OCR test runs the mock. This one downloads the actual weights and
 * reads actual pixels, because the things most likely to be wrong about a model
 * swap cannot be mocked: whether the graph runs in onnxruntime-web at all,
 * whether the charset lines up with the output layer, and whether detection
 * finds small text on a full page rather than only the headings.
 *
 * A wrong charset does not throw. It returns confident nonsense, which is why
 * this asserts on specific strings.
 */

test.describe("paddle", () => {
  // A 31 MB download and real inference on a large image.
  test.setTimeout(180_000);

  test("reads a dense page of Chinese, not just its headings", async ({
    page,
  }) => {
    await page.goto("#/paddle");
    await expect(page.getByTestId("canvas-surface")).toBeVisible();

    // Drawn at the size a phone photo of a form arrives at, with body text at a
    // document's proportions rather than a screenshot's — small relative to the
    // page, which is the case PP-OCRv5 mobile was losing.
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2400;
      canvas.height = 1400;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 2400, 1400);
      context.fillStyle = "#000000";

      context.font = "bold 64px sans-serif";
      context.fillText("體檢通知單", 120, 140);

      // The part that matters: ordinary body text, small relative to the page.
      context.font = "30px sans-serif";
      const lines = [
        "親愛的同仁您好，歡迎您加入本公司。",
        "請持本通知單於九十日內至醫療院所完成體檢。",
        "一、基本資料：廠別與工號請於報到後填寫。",
        "二、體檢類別：檢查項目依法規與合約規定辦理。",
        "三、注意事項說明：請詳閱新進員工體檢須知。",
        "四、體檢確認：請體檢醫院蓋章後交還受檢者。",
      ];
      lines.forEach((line, index) => {
        context.fillText(line, 120, 300 + index * 90);
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob!], "form.png", { type: "image/png" }));
      window.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const node = page.getByTestId("board-node");
    await expect(node).toHaveCount(1);
    await expect(node).toHaveAttribute("data-ocr-status", "done", {
      timeout: 170_000,
    });

    const words: string[] = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("canwas");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const all = open.result
              .transaction("assets", "readonly")
              .objectStore("assets")
              .getAll();
            all.onsuccess = () =>
              resolve(
                all.result.flatMap((asset: { ocr?: { words?: unknown[] } }) =>
                  (asset.ocr?.words ?? []).map(
                    (word) => (word as { text: string }).text,
                  ),
                ),
              );
            all.onerror = () => reject(all.error);
          };
        }),
    );

    const text = words.join("");
    // The heading alone proves very little — it is large and was never missed.
    // These are the body lines.
    expect(text).toContain("體檢通知單");
    expect(text).toContain("歡迎您加入");
    expect(text).toContain("報到後填寫");
    expect(text).toContain("體檢須知");
  });
});
