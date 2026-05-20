import { useEffect, useRef, useState } from 'react';
import { mountScene } from '@/globe/scene';
import { HudCounter } from './HudCounter';
import { SidePanel } from './SidePanel';
import { WebGLFallback } from './WebGLFallback';
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

  useEffect(() => {
    if (!supported) return;
    if (!canvasRef.current || !leaderRef.current || !panelRef.current) return;
    const handle = mountScene(canvasRef.current, leaderRef.current, panelRef.current);
    return () => handle.dispose();
  }, [supported]);

  if (!supported) return <WebGLFallback />;

  return (
    <>
      <a className="skip-link" href="#aircraft-list">
        Skip to aircraft list
      </a>
      <canvas ref={canvasRef} className="app-canvas" />
      <svg ref={leaderRef} className="app-leader" />
      <HudCounter />
      <SidePanel ref={panelRef} />
    </>
  );
}
