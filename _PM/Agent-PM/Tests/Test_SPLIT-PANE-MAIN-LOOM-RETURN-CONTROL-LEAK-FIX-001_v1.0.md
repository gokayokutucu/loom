# Test Checklist - Split Pane Return Control Leak Fix v1.0

- [x] Verify compilation with no errors: `npm run build`
- [x] Assert `.origin-split-panel` does NOT have a Return to Origin button: `await expect(page.locator(".origin-split-panel").getByRole("button", { name: "Return to Origin" })).not.toBeVisible();`
- [x] Assert `.weft-split-panel` still contains a Return to Origin button: `await expect(page.locator(".weft-split-panel").getByRole("button", { name: "Return to Origin" })).toBeVisible();`
- [x] Assert E2E tests pass: `npx playwright test e2e/prompt-edit.spec.ts`
- [x] Assert standard validation passes: `./loom.sh --test`
