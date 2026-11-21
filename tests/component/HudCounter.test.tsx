import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HudCounter } from '@/ui/HudCounter';
import { useAircraftStore } from '@/state/aircraftStore';

describe('HudCounter', () => {
  beforeEach(() =>
    useAircraftStore.setState({
      aircraft: new Map(),
      feedFetchedAt: 0,
      feedStale: false,
      fetchStatus: 'idle',
    })
  );

  it('says nothing about freshness while the feed is fresh', () => {
    render(<HudCounter />);
    expect(screen.queryByText(/feed stale/)).toBeNull();
  });

  it('declares a stale feed instead of drawing old positions as current', () => {
    // The last link of the chain this plan exists to break. The v1 feed was
    // frozen for 25 days and the globe never said so: the server served a
    // cached snapshot, the client drew it like live traffic, and the only
    // way to notice was to know an aircraft that had landed.
    useAircraftStore.setState({ feedStale: true });
    render(<HudCounter />);
    expect(screen.getByText(/feed stale/)).toBeInTheDocument();
  });
});
