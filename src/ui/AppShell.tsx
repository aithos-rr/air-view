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
      <a className="skip-link" href="#aircraft-list">
        Skip to aircraft list
      </a>
      <canvas ref={canvasRef} className="app-canvas" />
      <svg ref={leaderRef} className="app-leader" />
      <div ref={markersRef} className="app-markers" />
      <BrandWatermark />
      <FleetPanel />
      <FlightSearch />
      <SidePanel ref={panelRef} />
    </>
  );
}
