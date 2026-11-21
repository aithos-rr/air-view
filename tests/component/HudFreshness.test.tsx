import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { FeedStatus } from '@/ui/FeedStatus';
import { useAircraftStore } from '@/state/aircraftStore';

/**
 * The guard that does not depend on anyone telling the truth.
 *
 * Every other signal the HUD shows is something the SERVER said: the stale
 * flag, the error status. Each can go missing — a CDN rewriting the body, a
 * rolled-back server, a request that never answers at all. The age of the
 * batch in hand is measured on the browser's own clock and needs nobody's
 * cooperation, so it covers the cases the flags cannot.
 */
describe('FeedStatus — freshness the client can see for itself', () => {
  beforeEach(() => {
    useAircraftStore.setState({
      aircraft: new Map(), feedFetchedAt: 0, feedStale: false,
      fetchStatus: 'idle', feedCapped: false,
    });
  });
  afterEach(cleanup);

  it('says how old the data is once no batch has landed for minutes', () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    useAircraftStore.setState({ feedFetchedAt: nowUnix - 600, fetchStatus: 'idle' });
    render(<FeedStatus />);
    expect(screen.getByText(/last update/i)).toBeTruthy();
  });

  it('stays quiet while the feed is actually fresh', () => {
    const nowUnix = Math.floor(Date.now() / 1000);
    useAircraftStore.setState({ feedFetchedAt: nowUnix - 5, fetchStatus: 'idle' });
    render(<FeedStatus />);
    expect(screen.queryByText(/last update/i)).toBeNull();
  });

  it('says the world is truncated when the server declared it', () => {
    // server/index.ts puts `capped` in the body with the comment "Declared,
    // not silent. A truncated world served as the whole world is the same
    // class of failure as a frozen feed served as a live one". The client
    // used to read three fields and drop this one.
    useAircraftStore.setState({ feedCapped: true });
    render(<FeedStatus />);
    expect(screen.getByText(/partial world|truncated/i)).toBeTruthy();
  });
});
