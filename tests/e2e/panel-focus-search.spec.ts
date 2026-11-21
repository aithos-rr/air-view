import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * A known sky. playwright.config.ts starts Vite alone, so /api/states would
 * never answer; and even with the server up, a live feed is a different
 * fleet every run. Three aircraft, one of them complete with a real
 * LAS->LHR route — both airports are in public/data/airports.json, so the
 * D and A markers can actually be placed.
 */
const ROUTE = {
  originIata: 'LAS',
  originName: 'Harry Reid International Airport',
  destinationIata: 'LHR',
  destinationName: 'London Heathrow Airport',
  airlineName: 'British Airways',
};

function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1', callsign: 'BAW274', longitude: -10, latitude: 50,
    baroAltitudeFt: 38000, velocityKt: 472, headingDeg: 261, onGround: false,
    lastContact: 1_716_163_200, registration: 'G-ZBKA', modelCode: 'B789',
    modelDesc: null, route: null, complete: false, ...over,
  };
}

async function withFleet(page: Page): Promise<void> {
  await page.route('**/api/states*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fetchedAt: new Date().toISOString(),
        stale: false,
        capped: false,
        source: 'test',
        aircraft: [
          aircraft({ icao24: 'a1', callsign: 'BAW274', route: ROUTE, complete: true }),
          aircraft({ icao24: 'a2', callsign: 'RYR1234', latitude: 45, longitude: 9 }),
          aircraft({ icao24: 'a3', callsign: 'NJE004M', latitude: 48, longitude: 2 }),
        ],
      }),
    });
  });
}

test('the counter opens into a panel whose numbers add up', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  const summary = page.locator('.hud__summary');
  await expect(summary).toContainText('3 aircraft');
  await summary.click();
  await expect(page.getByRole('checkbox', { name: /full route/i })).toBeVisible();
  await expect(page.getByTestId('count-complete')).toHaveText('1');
  await expect(page.getByTestId('count-partial')).toHaveText('2');
});

test('switching the greys off says how many it hid, and goes on saying it', async ({ page }) => {
  // At the measured 3,5% complete this is what a real user will see: a
  // nearly empty globe. It must never be a mystery — and it must not stop
  // being explained the moment the drawer closes, because the drawer
  // closes and the filter does not (D14). Esc is the key a user presses to
  // close things, so the explanation used to leave at exactly the moment
  // they were looking for it.
  await withFleet(page);
  await page.goto('/');
  await page.locator('.hud__summary').click();
  await page.getByRole('checkbox', { name: /partial data/i }).click();
  await expect(page.getByText(/2 hidden by filters/i)).toBeVisible();

  await page.keyboard.press('Escape'); // the fleet drop-down, and only it
  await expect(page.getByRole('checkbox', { name: /partial data/i })).toHaveCount(0);
  await expect(page.getByText(/2 hidden by filters/i)).toBeVisible();
  await expect(page.locator('.hud__summary')).toContainText('1 of 3 aircraft');
});

test('searching a flight in the feed focuses it and plants D and A', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BA274'); // the IATA spelling
  await page.getByRole('searchbox').press('Enter');
  await expect(page.locator('.marker[data-end="origin"]')).toBeVisible();
  await expect(page.locator('.marker[data-end="destination"]')).toBeVisible();
  await expect(page.locator('.panel__callsign')).toContainText('BAW274');
});

test('clicking a marker shows the airport, and no terminal is invented', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');
  await page.locator('.marker[data-end="origin"]').click();
  await expect(page.getByText(/Harry Reid International Airport/)).toBeVisible();
  await expect(page.getByText(/terminal/i)).toHaveCount(0);
});

test('an unknown flight number says so and leaves the globe alone', async ({ page }) => {
  await withFleet(page);
  await page.route('**/api/route/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      // A MEASURED verdict: adsbdb was asked about this callsign and
      // has no route for it. It is the only status the sentence below is
      // allowed to come from — 'notLookedUpYet' says nobody looked yet.
      body: JSON.stringify({ callsign: 'ZZZ999', status: 'noRoute', route: null }),
    });
  });
  await page.goto('/');
  await page.getByRole('searchbox').fill('ZZ999');
  await page.getByRole('searchbox').press('Enter');
  await expect(page.getByText(/no flight by that number/i)).toBeVisible();
  await expect(page.locator('.marker')).toHaveCount(0);
});

test('Escape walks back out one step per press', async ({ page }) => {
  await withFleet(page);
  await page.goto('/');
  await page.locator('.hud__summary').click();
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');
  await page.locator('.marker[data-end="origin"]').click();

  await page.keyboard.press('Escape'); // the airport card
  await expect(page.getByText(/Harry Reid/)).toHaveCount(0);
  await expect(page.locator('.marker[data-end="origin"]')).toBeVisible();

  await page.keyboard.press('Escape'); // the search, and with it the focus
  await expect(page.locator('.marker')).toHaveCount(0);
  // The flight card went with the flight it belonged to, and what is left
  // is the way back in — not an empty box beside a refilled globe (D13).
  await expect(page.locator('.panel__toggle')).toBeVisible();

  await page.keyboard.press('Escape'); // the fleet drop-down
  await expect(page.getByRole('checkbox', { name: /full route/i })).toHaveCount(0);
});

test('dismissing the flight card gives the sky back, and says so while it is gone', async ({
  page,
}) => {
  // The tenth defect of the family, in a browser. The ✕ called the panel's
  // close() alone: the card went away, the focus stayed on, and the globe
  // kept drawing one aircraft of three while the only words explaining
  // that had just been dismissed with the card (D15).
  await withFleet(page);
  await page.goto('/');
  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');

  // While the focus holds, the count says what is drawn and a line says why.
  await expect(page.locator('.hud__summary')).toContainText('1 of 3 aircraft');
  await expect(page.getByText(/2 hidden while one flight is in focus/i)).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.hud__summary')).toContainText('3 aircraft');
  await expect(page.locator('.hud__summary')).not.toContainText('1 of 3');
  await expect(page.getByText(/in focus/i)).toHaveCount(0);
  await expect(page.locator('.marker')).toHaveCount(0);
  await expect(page.locator('.panel__toggle')).toBeVisible();
});
