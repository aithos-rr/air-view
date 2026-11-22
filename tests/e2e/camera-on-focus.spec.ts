import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * D34 in a browser: the camera travels to a flight the user NAMED, and
 * leaves the view alone when they POINTED at one.
 *
 * Neither half of that is visible in the DOM. The D/A markers follow the
 * route's airports and not the flight, and the "behind the globe" note is
 * only ever about the far side — so the only honest witness is the camera
 * itself, which scene.ts publishes behind the profiler's own switch next to
 * the probe tests/e2e/density-motion.spec.ts already reads.
 */
interface CameraReading {
  lat: number;
  lon: number;
  distance: number;
}

/**
 * Where scene.ts puts the camera at mount: (-1,2 / 0,6 / 4,6), which is
 * 4,792 units out over 7,19 N 14,61 W. Every placement below is chosen
 * against this point, so it is written down once.
 */
const START_LAT = 7.1935;
const START_LON = -14.6102;

/** Very nearly the antipode of that: the whole globe away, certainly hidden. */
const FAR = { lat: 10, lon: 170 };

/**
 * Directly under the camera, which puts it at the exact centre of the
 * canvas — the one screen position a test can click without reproducing the
 * projection matrix.
 */
const IN_VIEW = { lat: START_LAT, lon: START_LON };

/**
 * No speed and no heading, so the dead reckoning leaves both aircraft on
 * their fix (advanceFor answers STILL) and every coordinate in this file
 * stays the coordinate it was written as.
 */
function aircraft(over: Record<string, unknown>): Record<string, unknown> {
  return {
    icao24: 'a1', callsign: 'BAW274', longitude: -10, latitude: 50,
    baroAltitudeFt: 38000, velocityKt: null, headingDeg: null, onGround: false,
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
          aircraft({
            icao24: 'a1', callsign: 'BAW274',
            latitude: FAR.lat, longitude: FAR.lon,
          }),
          aircraft({
            icao24: 'a2', callsign: 'RYR1234',
            latitude: IN_VIEW.lat, longitude: IN_VIEW.lon,
          }),
        ],
      }),
    });
  });
}

async function camera(page: Page): Promise<CameraReading> {
  return page.evaluate(() => {
    const w = window as unknown as { __airViewCamera?: () => CameraReading };
    const reading = w.__airViewCamera?.();
    if (!reading) throw new Error('scene.ts published no camera probe');
    return reading;
  });
}

/** Waits until the camera is over this point, however it got there. */
async function expectCameraOver(
  page: Page,
  at: { lat: number; lon: number }
): Promise<void> {
  await expect
    .poll(async () => {
      const c = await camera(page);
      return `${Math.round(c.lat)},${Math.round(c.lon)}`;
    })
    .toBe(`${Math.round(at.lat)},${Math.round(at.lon)}`);
}

/**
 * The three tests that only have to show WHICH WAY the camera went, under
 * an emulated prefers-reduced-motion.
 *
 * Two things follow from it, and both are the point rather than a
 * convenience. The globe does not auto-rotate (scene.ts gates autoRotate on
 * the same preference), so "the camera did not move" is a claim about the
 * camera and not a race with the idle spin. And the turn itself is a CUT,
 * which is the behaviour D34 promises this user and is asserted here as
 * such: the arrival needs no waiting, and the travel is the next test's job.
 */
test.describe('which focus moves the camera', () => {
  // Through contextOptions: Playwright 1.60 carries reducedMotion on the
  // browser context rather than as a test option of its own.
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('a flight found by its number is brought into view', async ({ page }) => {
    // The user typed a flight number. They cannot know where it is, and
    // under focus the globe draws that one aircraft and nothing else — so
    // on the far side they would be shown an empty planet while the panel
    // said "1 shown".
    await withFleet(page);
    await page.goto('/');
    await expect(page.locator('.hud__summary')).toContainText('2 aircraft');
    const before = await camera(page);
    expect(Math.round(before.lon)).toBe(Math.round(START_LON));

    await page.getByRole('searchbox').fill('BAW274');
    await page.getByRole('searchbox').press('Enter');

    await expect(page.locator('.panel__callsign')).toContainText('BAW274');
    await expectCameraOver(page, FAR);
  });

  test('a flight clicked on the globe is left exactly where it was', async ({ page }) => {
    // The other half, and the half the user asked for by name: they were
    // looking at this aircraft, it was under the cursor. Moving the camera
    // would take away the view they chose to show them what they could
    // already see.
    await withFleet(page);
    await page.goto('/');
    await expect(page.locator('.hud__summary')).toContainText('2 aircraft');
    const before = await camera(page);

    // RYR1234 sits directly under the camera, so it projects to the centre
    // of the canvas — which is where locator.click() lands.
    await page.locator('canvas').click();
    await expect(page.locator('.panel__callsign')).toContainText('RYR1234');

    // Longer than a turn would take, so this is "it never moved" and not
    // "it had not moved yet".
    await page.waitForTimeout(1_500);
    const after = await camera(page);
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lon).toBeCloseTo(before.lon, 6);
    expect(after.distance).toBeCloseTo(before.distance, 6);
  });

  test('a flight already in view is not travelled to', async ({ page }) => {
    // Idempotence, through the search box — the door that DOES travel. The
    // test is the globe's own: the subject is already on the near side, so
    // there is nothing to bring round and the view stays as it is.
    await withFleet(page);
    await page.goto('/');
    await expect(page.locator('.hud__summary')).toContainText('2 aircraft');
    const before = await camera(page);

    await page.getByRole('searchbox').fill('RYR1234');
    await page.getByRole('searchbox').press('Enter');
    await expect(page.locator('.panel__callsign')).toContainText('RYR1234');

    await page.waitForTimeout(1_500);
    const after = await camera(page);
    expect(after.lat).toBeCloseTo(before.lat, 6);
    expect(after.lon).toBeCloseTo(before.lon, 6);
  });
});

test('the turn rotates over time, and never changes the zoom', async ({ page }) => {
  // With motion allowed the journey is the thing: "una bella rotazione
  // lenta, tranquilla". Timing it from Node would be a race against the
  // round trip, so the page records every frame for itself and the
  // assertion is made on the recording afterwards.
  await withFleet(page);
  await page.goto('/');
  await expect(page.locator('.hud__summary')).toContainText('2 aircraft');

  // A wheel stops the idle auto-rotation (scene.ts), so from here the only
  // thing that can move this camera is the turn under test. It also dollies
  // once, which is exactly why the zoom baseline is taken after it.
  await page.locator('canvas').dispatchEvent('wheel', { deltaY: 1 });
  await page.waitForTimeout(300);
  const before = await camera(page);

  await page.evaluate(() => {
    const w = window as unknown as {
      __airViewCamera?: () => CameraReading;
      __camTrack?: string[];
    };
    w.__camTrack = [];
    const tick = (): void => {
      const c = w.__airViewCamera?.();
      if (c) w.__camTrack?.push(`${c.lat.toFixed(4)},${c.lon.toFixed(4)}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.getByRole('searchbox').fill('BAW274');
  await page.getByRole('searchbox').press('Enter');
  await expectCameraOver(page, FAR);

  const track = await page.evaluate(() => {
    const w = window as unknown as { __camTrack?: string[] };
    return [...new Set(w.__camTrack ?? [])];
  });
  // A cut would leave two: where it was, and where it ended. 900 ms of
  // rotation leaves tens of them. Ten is far below what sixty frames a
  // second produces and far above what any instant jump could.
  expect(track.length).toBeGreaterThan(10);

  // Rotate, never zoom: how much world to show is the user's choice, and
  // the turn answers "where", never "how close".
  const after = await camera(page);
  expect(after.distance).toBeCloseTo(before.distance, 6);
});
