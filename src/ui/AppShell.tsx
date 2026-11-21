import { useEffect, useRef, useState } from 'react';
import { mountScene } from '@/globe/scene';
import { bootstrapData, teardownData } from '@/data/bootstrap';
import { BrandWatermark } from './BrandWatermark';
import { FleetPanel } from './FleetPanel';
import { FlightSearch } from './FlightSearch';
import { SidePanel } from './SidePanel';
import { WebGLFallback } from './WebGLFallback';
import { handleEscape } from '@/state/escape';
import './styles.css';

function detectWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export default function AppShell() {
  const [supported] = useState(detectWebGL2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leaderRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);

  // The only Escape listener in the application. See state/escape.ts for the
  // order; it is here rather than in a panel because the key belongs to the
  // page, not to whichever component happens to be mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (handleEscape()) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!supported) return;
    if (!canvasRef.current || !leaderRef.current || !panelRef.current || !markersRef.current)
      return;
    const handle = mountScene(
      canvasRef.current,
      leaderRef.current,
      panelRef.current,
      markersRef.current
    );
    void bootstrapData(() => handle.viewCentre()).catch((e: unknown) =>
      console.error('bootstrap:', e)
    );
    return () => {
      handle.dispose();
      teardownData();
    };
  }, [supported]);

  if (!supported) return <WebGLFallback />;

  return (
    <>
      {/*
        The target has to be something that is ALWAYS rendered. This link used
        to point at #aircraft-list, which AircraftList mounts only while the
        side panel is in list mode — so on the page a keyboard user actually
        lands on, the anchor led nowhere. axe-core called it a skip-link whose
        target does not exist; in this project's terms it was the interface
        offering something that is not there.
      */}
      <a className="skip-link" href="#controls">
        Skip to controls
      </a>
      {/*
        A landmark around everything that is not the canvas. Without it a
        screen-reader user browsing by region reached the side panel — its own
        <aside> — and nothing else: not the fleet panel, not the search, not
        the watermark. tabIndex -1 makes it a legal destination for the skip
        link without putting it in the tab order.
      */}
      <main id="controls" tabIndex={-1} className="app-controls">
        {/*
          The globe is the page's content, so it belongs inside the landmark
          too — axe-core counted the bare <canvas> as the last thing outside
          one. DOM order is unchanged, and `display: contents` on the wrapper
          means paint order and the fixed positioning of its siblings are
          unchanged with it.
        */}
        <canvas ref={canvasRef} className="app-canvas" />
        <svg ref={leaderRef} className="app-leader" />
        <div ref={markersRef} className="app-markers" />
        <BrandWatermark />
        <FleetPanel />
        <FlightSearch />
      </main>
      <SidePanel ref={panelRef} />
    </>
  );
}
