import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home page passes axe-core in default mode', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('home page passes axe-core in panel-open mode', async ({ page }) => {
  await page.goto('/');
  await page.locator('.panel__toggle').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('the fleet panel and the search bar pass axe-core', async ({ page }) => {
  // Three new surfaces have never been under axe: the disclosure button,
  // two checkboxes and a search landmark.
  await page.goto('/');
  await page.locator('.hud__summary').click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
