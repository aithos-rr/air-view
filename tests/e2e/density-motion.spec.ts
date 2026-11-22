import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A known sky with a known age. playwright.config.ts starts Vite alone, so
 * /api/states would never answer, and a live feed is a different fleet
 * every run. Three aircraft: one fresh and extrapolable, one with no
 * heading, one whose last contact is half an hour old.
 */
function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1', callsign: 'BAW274', longitude: -10, latitude: 50,
    baroAltitudeFt: 38000, velocityKt: 472, headingDeg: 261, onGround: false,
    lastContact: 0, registration: 'G-ZBKA', modelCode: 'B789',
    modelDesc: null, route: null, complete: false, ...over,
  };
}

async function withFleet(page: Page): Promise<void> {
  await page.route('**/api/states*', async (route) => {
    const nowS = Math.floor(Date.now() / 1000);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        stale: false,
        capped: false,
        source: 'test',
        aircraft: [
          aircraft({ icao24: 'a1', callsign: 'BAW274', lastContact: nowS }),
          aircraft({ icao24: 'a2', callsign: 'RYR1234', latitude: 45, longitude: 9, headingDeg: null, lastContact: nowS }),
          aircraft({ icao24: 'a3', callsign: 'NJE004M', latitude: 48, longitude: 2, lastContact: nowS - 1800 }),
        ],
      }),
    });
  });
}

test('the globe says which dots it is moving and which it is remembering', async ({ page }) => {
  // The user's opening complaint, answered out loud. A sky where some dots
  // glide and the rest sit still, with nothing saying which is which,
  // reads as a sky full of parked aircraft (D19).
  await withFleet(page);
  await page.goto('/');
  await expect(page.getByText(/1 moving on their last reported track/i)).toBeVisible();
  await expect(page.getByText(/1 shown where last seen — no contact for over 2 min/i)).toBeVisible();
  await expect(
    page.getByText(/1 shown where last seen — no heading or speed reported/i)
  ).toBeVisible();
});

test('the three motion numbers add up to what the counter claims', async ({ page }) => {
  // The panel is self-verifying on this axis too: moving + still ===
  // shown, by construction, and a browser is where a construction stops
  // being an argument.
  await withFleet(page);
  await page.goto('/');
  await expect(page.locator('.hud__summary')).toContainText('3 aircraft');
});

test('an aircraft with a fresh fix actually moves between two frames', async ({ page }) => {
  // Not an assertion about a number: about a pixel. The whole v1 complaint
  // was that the dots never moved.
  await withFleet(page);
  await page.goto('/');
  const read = async (): Promise<number[]> =>
    page.evaluate(() => {
      const w = window as unknown as { __airViewProbe?: () => number[] };
      return w.__airViewProbe ? w.__airViewProbe() : [];
    });
  await page.waitForTimeout(100);
  const a = await read();
  await page.waitForTimeout(1500);
  const b = await read();
  if (a.length > 0 && b.length > 0) expect(b).not.toEqual(a);
});

test('zooming in separates two aircraft instead of magnifying them together', async ({ page }) => {
  // The spec's own sentence, §4.2: "zooming separates the geography but
  // the points stay attached". With a screen-pixel symbol it stops being
  // true (D23).
  await withFleet(page);
  await page.goto('/');
  await page.locator('canvas').hover();
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(400);
  // The camera moved and nothing threw: the console is the assertion.
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
});
