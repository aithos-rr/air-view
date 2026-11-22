import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A known sky, because playwright.config.ts starts Vite alone and /api/states
 * would never answer. Three aircraft over Europe, where the zoom tests below
 * point the camera.
 */
function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1',
    callsign: 'BAW274',
    longitude: 9,
    latitude: 45,
    baroAltitudeFt: 38000,
    velocityKt: 472,
    headingDeg: 261,
    onGround: false,
    lastContact: 0,
    registration: 'G-ZBKA',
    modelCode: 'B789',
    modelDesc: null,
    route: null,
    complete: false,
    ...over,
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
          aircraft({ icao24: 'a1', lastContact: nowS }),
          aircraft({ icao24: 'a2', callsign: 'RYR1234', latitude: 45.05, longitude: 9.05, lastContact: nowS }),
          aircraft({ icao24: 'a3', callsign: 'NJE004M', latitude: 44.9, longitude: 8.9, lastContact: nowS }),
        ],
      }),
    });
  });
}

/**
 * Bring the camera down past FINE_SWITCH_DISTANCE through the hook scene.ts
 * already exposes, rather than by synthesising wheel events: a zoom driven by
 * input is a test of OrbitControls, and what is under test here is what the
 * globe does once it is close.
 */
async function zoomTo(page: Page, distance: number): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __airViewZoomTo?: (d: number) => void };
    return typeof w.__airViewZoomTo === 'function';
  });
  await page.evaluate((d) => {
    const w = window as unknown as { __airViewZoomTo?: (d: number) => void };
    w.__airViewZoomTo?.(d);
  }, distance);
  // Several frames: the prefetch fires on one, the chunked build takes about
  // fifteen more, and the crossfade is 300 ms after that.
  await page.waitForTimeout(1500);
}

test('says so when the fine coastline does not arrive, and keeps the coarse one', async ({
  page,
}) => {
  // D42. A viewer at d = 1,6 looking at a polygonal coast has no way to tell
  // "the fine level did not arrive" from "the fine level is this" — unless
  // the screen says which.
  await withFleet(page);
  let asked = 0;
  await page.route('**/data/coastline-10m.bin', (route) => {
    asked++;
    return route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await zoomTo(page, 1.6);

  await expect(page.getByText(/fine coastline unavailable/)).toBeVisible();
  await expect(page.getByText(/1:50 M outline/)).toBeVisible();

  // It asks ONCE, and the line that explains it holds still.
  //
  // The failure branch used to put the phase back to 'idle', and the gate it
  // reopened is `idle && close enough` — true for every frame the user stays
  // zoomed in. So: 1,91 MB requested, refused, requested again, at the rate
  // the server could say no. And because loadFineCoastline opens with
  // setCoastline('loading'), each retry took the state out of 'coarse-only'
  // and the sentence below vanished and came back, dozens of times a second.
  // toBeVisible() above could not see that: Playwright retries until it
  // catches a frame where the text is there (D49).
  const line = page.getByText(/fine coastline unavailable/);
  for (let i = 0; i < 20; i++) {
    expect(await line.count()).toBe(1);
    await page.waitForTimeout(100);
  }
  expect(asked).toBe(1);
  // And the coarse outline is still drawn: one level failed, not the globe.
  const coarseDrawn = await page.evaluate(() => {
    const w = window as unknown as { __airViewCoastline?: () => string };
    return w.__airViewCoastline?.() ?? null;
  });
  expect(coarseDrawn).toBe('coarse-only');
});

test('refuses a truncated coastline rather than drawing half a world', async ({ page }) => {
  // The worst side of D42: half-decoded data draws a coastline nobody can
  // tell from the real one. decodeCoastline throws naming the file, the
  // state goes to coarse-only, and the line appears.
  await withFleet(page);
  // Half the REAL file, read here in Node rather than fetched through the
  // route. `route.fetch()` never came back for this 1,91 MB asset — the
  // handler ran, the page's own request stayed open, the phase sat on
  // 'loading' for as long as anyone watched, and the only thing the test
  // reported was that a sentence was missing. Reading the artifact off disk
  // is also what makes the body deterministic: this is the file that ships.
  const truncated = readFileSync(join(process.cwd(), 'public/data/coastline-10m.bin'));
  await page.route('**/data/coastline-10m.bin', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: truncated.subarray(0, Math.floor(truncated.length / 2)),
    })
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await zoomTo(page, 1.6);

  await expect(page.getByText(/fine coastline unavailable/)).toBeVisible();
});

test('says nothing at all when the fine coastline does arrive', async ({ page }) => {
  // A HUD that narrates its successes is a HUD nobody is still reading when
  // it narrates a failure.
  await withFleet(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await zoomTo(page, 1.6);

  await expect(page.getByText(/fine coastline unavailable/)).toHaveCount(0);
  await expect(page.getByText(/no coastline/)).toHaveCount(0);
});

test('says so when the globe has no coastline at all', async ({ page }) => {
  // The hole that predates this plan: scene.ts caught loadContinents failing
  // with a console.warn, so a 404 after a deploy drew a globe with no coasts
  // and not one word about it.
  await withFleet(page);
  await page.route('**/data/ne_50m_admin_0_countries.geojson', (route) =>
    route.fulfill({ status: 404 })
  );
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByText(/no coastline/)).toBeVisible();
  await expect(page.getByText(/map data did not load/)).toBeVisible();
});

test('at the bottom of the travel the detail is there and nothing is clipped', async ({ page }) => {
  // The whole plan, in a real browser. Four claims, none of which a unit
  // test can make: the fine outline is in the scene, city names are visible
  // and do not cover one another, and no aircraft has been cut away by the
  // near plane that had to drop to 0,02 to let the camera this close.
  await withFleet(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await zoomTo(page, 1.55);

  // 1. The fine level is the one being drawn, and it SAYS so.
  //
  // Polled, not read once. zoomTo waits 1 500 ms, which is enough on a fast
  // machine and is not enough here: measured on this one the state is still
  // 'loading' when that wait ends and is 'fine' half a second later — 1,91 MB
  // to fetch, 4 095 rings to decode and fifteen chunked build frames at the
  // 9 fps a software GL gives. A single read of an asynchronous pipeline is
  // a coin toss reported as a verdict, which is the mistake the motion test
  // was already fixed for once.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const w = window as unknown as { __airViewCoastline?: () => string };
          return w.__airViewCoastline?.() ?? null;
        }),
      { timeout: 20_000 }
    )
    .toBe('fine');
  await expect(page.getByText(/fine coastline unavailable/)).toHaveCount(0);

  // 2. City names are on screen. At a 39,6 NM cap the ceiling is "all",
  //    and the worst measured case is 11 candidates.
  const names = page.locator('.city:visible');
  expect(await names.count()).toBeGreaterThan(0);

  // 3. No two of them overlap. The greedy pass is supposed to guarantee
  //    this; here it is measured on the boxes the browser actually laid out.
  const boxes = await names.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    })
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlaps =
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlaps, `labels ${i} and ${j} overlap`).toBe(false);
    }
  }

  // 4. The aircraft are still drawn. Before the near plane came down to
  //    0,02 a 41 000 ft aircraft under the camera was clipped at d = 1,675
  //    and behind it below 1,575 — silently, with fewer dots and no error.
  const head = await page.evaluate(() => {
    const w = window as unknown as { __airViewProbe?: () => number[] };
    return w.__airViewProbe?.() ?? null;
  });
  expect(head).not.toBeNull();
  const radius = Math.hypot(head![0]!, head![1]!, head![2]!);
  // On the thin shell a cruising aircraft sits just above GLOBE_RADIUS, and
  // well inside the camera at 1,55 — which is what "not clipped" means.
  expect(radius).toBeGreaterThan(1.5);
  expect(radius).toBeLessThan(1.53);
});
