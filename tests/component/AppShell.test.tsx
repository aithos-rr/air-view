import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ViewCentre } from '@/globe/scene';

/**
 * The last link of Step 9's chain: AppShell is the only place where the
 * scene and the data stream meet, and nothing used to look at the join.
 * Dropping the argument, or capturing the framing once at mount, both
 * compiled and both left the suite green while the server received either
 * nothing or the view the user had when the page loaded.
 */
const mocks = vi.hoisted(() => ({
  mountScene: vi.fn(),
  viewCentre: vi.fn(),
  dispose: vi.fn(),
  bootstrapData: vi.fn(),
  teardownData: vi.fn(),
}));

vi.mock('@/globe/scene', () => ({ mountScene: mocks.mountScene }));
vi.mock('@/data/bootstrap', () => ({
  bootstrapData: mocks.bootstrapData,
  teardownData: mocks.teardownData,
}));

// Imported after the mocks on purpose: AppShell pulls in both modules.
import AppShell from '@/ui/AppShell';

// jsdom has no WebGL2, and AppShell renders the fallback without it — which
// would make every assertion below vacuous. Hand it a context object; the
// scene that would use it is mocked out.
const canvasProto = HTMLCanvasElement.prototype as unknown as {
  getContext: (id: string) => unknown;
};
let realGetContext: (id: string) => unknown;

describe('AppShell', () => {
  beforeEach(() => {
    realGetContext = canvasProto.getContext;
    canvasProto.getContext = (id: string) => (id === 'webgl2' ? {} : null);
    mocks.mountScene.mockReturnValue({ dispose: mocks.dispose, viewCentre: mocks.viewCentre });
    mocks.viewCentre.mockReturnValue({ lat: 50, lon: 8, radiusNm: 1299 });
    mocks.bootstrapData.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    canvasProto.getContext = realGetContext;
    vi.clearAllMocks();
  });

  it('gives bootstrapData a live reading of the camera, not a frozen one', () => {
    render(<AppShell />);

    expect(mocks.mountScene).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrapData).toHaveBeenCalledTimes(1);

    // Called with nothing at all, the server never learns where the viewer
    // is looking and the tile priority of Task 3 goes back to being dead.
    const getCentre = mocks.bootstrapData.mock.calls[0]?.[0] as
      | (() => ViewCentre | null)
      | undefined;
    expect(typeof getCentre).toBe('function');

    expect(getCentre?.()).toEqual({ lat: 50, lon: 8, radiusNm: 1299 });

    // Now the user turns the globe. A centre captured once at mount keeps
    // answering with the old framing for the rest of the session.
    mocks.viewCentre.mockReturnValue({ lat: -33, lon: 151, radiusNm: 2400 });
    expect(getCentre?.()).toEqual({ lat: -33, lon: 151, radiusNm: 2400 });
  });

  it('tears the scene and the stream down together on unmount', () => {
    const { unmount } = render(<AppShell />);
    unmount();
    expect(mocks.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.teardownData).toHaveBeenCalledTimes(1);
  });
});

/**
 * Two accessibility defects axe-core found on the live page, both of the
 * family this project keeps meeting: the interface offers something that
 * is not there.
 *
 * The skip link said "Skip to aircraft list" and pointed at #aircraft-list,
 * which AircraftList renders only while the side panel is in list mode. On
 * the page a keyboard user actually lands on, the target did not exist — a
 * promise the markup could not keep. And nothing outside the side panel sat
 * inside a landmark, so screen-reader users browsing by region never
 * reached the globe's controls at all.
 */
describe('AppShell — a keyboard user can get off the canvas', () => {
  let realGetContext2: (id: string) => unknown;
  beforeEach(() => {
    realGetContext2 = canvasProto.getContext;
    canvasProto.getContext = (id: string) => (id === 'webgl2' ? {} : null);
    mocks.mountScene.mockReturnValue({ dispose: mocks.dispose, viewCentre: mocks.viewCentre });
    mocks.viewCentre.mockReturnValue({ lat: 50, lon: 8, radiusNm: 1299 });
    mocks.bootstrapData.mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    canvasProto.getContext = realGetContext2;
    vi.clearAllMocks();
  });

  it('points the skip link at something that is always there', () => {
    const { container } = render(<AppShell />);
    const link = container.querySelector('a.skip-link');
    expect(link).not.toBeNull();
    const href = link!.getAttribute('href') ?? '';
    expect(href.startsWith('#')).toBe(true);
    const target = container.querySelector(href);
    expect(target).not.toBeNull();
    // Focusable, or the skip is a jump to nowhere for the keyboard.
    expect(target!.getAttribute('tabindex')).toBe('-1');
  });

  it('puts the page content inside a landmark', () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector('main')).not.toBeNull();
  });
});
