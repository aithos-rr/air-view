import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedStatus } from '@/ui/FeedStatus';
import { useAircraftStore } from '@/state/aircraftStore';
import { useDetailStore } from '@/state/detailStore';

describe('FeedStatus', () => {
  beforeEach(() =>
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    })
  );

  it('says nothing about freshness while the feed is fresh', () => {
    render(<FeedStatus />);
    expect(screen.queryByText(/feed stale/)).toBeNull();
  });

  it('declares a stale feed instead of drawing old positions as current', () => {
    // The last link of the chain this plan exists to break. The v1 feed was
    // frozen for 25 days and the globe never said so: the server served a
    // cached snapshot, the client drew it like live traffic, and the only
    // way to notice was to know an aircraft that had landed.
    useAircraftStore.setState({ feedStale: true });
    render(<FeedStatus />);
    expect(screen.getByText(/feed stale/)).toBeInTheDocument();
  });
});

describe('FeedStatus — the detail levels that are not there', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    });
    useDetailStore.setState({ coastline: 'coarse', cities: 'absent' });
  });

  it('says nothing about a detail level that IS there', () => {
    // A level that arrived is not news, and a HUD that narrates its
    // successes is a HUD nobody is still reading when it narrates a
    // failure. 'loading' is silent for the same reason: 1,6 s of download
    // is not a fact about the globe, it is a fact about the next second.
    for (const c of ['coarse', 'loading', 'fine'] as const) {
      useDetailStore.setState({ coastline: c });
      const { unmount } = render(<FeedStatus />);
      expect(screen.queryByText(/coastline/)).toBeNull();
      expect(screen.queryByText(/map data/)).toBeNull();
      unmount();
    }
  });

  it('says so when the globe has no coastline at all', () => {
    // The hole that predates this plan: scene.ts caught loadContinents
    // failing with a console.warn, so a 404 after a deploy drew a globe
    // with no coasts and not one word about it.
    useDetailStore.setState({ coastline: 'none' });
    render(<FeedStatus />);
    expect(screen.getByText(/no coastline/)).toBeInTheDocument();
    expect(screen.getByText(/map data did not load/)).toBeInTheDocument();
  });

  it('distinguishes "not asked for" from "asked for and did not arrive"', () => {
    // D15b, in one render. Merging the two words would tell a viewer whose
    // fine level 404s exactly what it tells a viewer who has not zoomed in
    // yet: nothing.
    useDetailStore.setState({ coastline: 'coarse-only', cities: 'unavailable' });
    render(<FeedStatus />);
    expect(screen.getByText(/fine coastline unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/1:50 M outline/)).toBeInTheDocument();
    expect(screen.getByText(/city names unavailable/)).toBeInTheDocument();
  });
});
