import { expect, test } from "@playwright/test";

/**
 * Every icon in the app is a Material Symbols ligature: the element's text
 * *is* the glyph name, and the font substitutes one glyph for it. A name the
 * font does not carry does not fail — it renders as the literal words, so
 * `delete_sweep` appears in the middle of a panel as thirteen characters of
 * body text. Nothing in the type system or the linter can catch that, which is
 * why it is measured.
 *
 * A substituted glyph is roughly square at its font size. Unsubstituted text
 * is several times wider, and the two cannot be confused at this margin.
 */
test("every icon resolves to a glyph rather than to its own name", async ({
  page,
}) => {
  await page.goto("?engine=mock#/iconboard");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();

  // Both panels, so the icons that only exist inside them are measured too.
  await page.getByTestId("about-open").click();
  await expect(page.getByTestId("about-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("sync-button").click();
  await expect(page.getByTestId("sync-panel")).toBeVisible();

  await page.evaluate(() => document.fonts.ready);

  const glyphs = await page
    .locator(".material-symbol")
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const size = parseFloat(getComputedStyle(element).fontSize);
        return { name: element.textContent ?? "", width: rect.width, size };
      }),
    );

  expect(glyphs.length).toBeGreaterThan(0);
  for (const glyph of glyphs) {
    // Generous: a few Material Symbols are slightly wider than their em box.
    // Two ems still leaves no room for a word.
    expect(
      glyph.width,
      `"${glyph.name}" is not a Material Symbols glyph`,
    ).toBeLessThan(glyph.size * 2);
  }
});
