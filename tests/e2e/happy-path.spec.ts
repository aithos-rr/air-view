import { test, expect } from '@playwright/test';

test('boots and renders the globe + HUD', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas.app-canvas')).toBeVisible();
  const hud = page.locator('.hud');
  await expect(hud).toBeVisible();
  await expect(hud).toContainText(/\d+ aircraft/);
});

test('panel opens on toggle, list renders, Esc closes', async ({ page }) => {
  await page.goto('/');
  await page.locator('.panel__toggle').click();
  await expect(page.locator('#aircraft-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.panel__toggle')).toBeVisible();
});
