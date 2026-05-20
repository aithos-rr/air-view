import { PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGlobe } from './globe';
import { createAtmosphere } from './atmosphere';
import { loadContinents } from './continents';
import { createAircraftLayer } from './aircraft';
import { createTrailsLayer } from './trails';
import { LeaderLine } from './leaderLine';
import { findAircraftAtPointer } from './raycaster';
import { latLonAltToVec3 } from './geoHelpers';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useA11yStore } from '@/state/a11yStore';

export interface SceneHandle {
  dispose: () => void;
}

export function mountScene(
  canvas: HTMLCanvasElement,
  leaderSvg: SVGElement,
  panelEl: HTMLElement
): SceneHandle {
  const scene = new Scene();

  const camera = new PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(-1.2, 0.6, 4.6);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3.0;
  controls.maxDistance = 10.0;
  controls.enablePan = false;
  controls.autoRotate = !useA11yStore.getState().prefersReducedMotion;
  controls.autoRotateSpeed = 0.8;

  let userInteracted = false;
  const stopRotate = (): void => {
    if (!userInteracted) {
      controls.autoRotate = false;
      userInteracted = true;
    }
  };
  canvas.addEventListener('pointerdown', stopRotate);
  canvas.addEventListener('wheel', stopRotate, { passive: true });

  // Layers
  const atmosphere = createAtmosphere();
  scene.add(atmosphere.mesh);
  const globe = createGlobe();
  scene.add(globe.mesh);
  const aircraftLayer = createAircraftLayer();
  scene.add(aircraftLayer.group);
  const trailsLayer = createTrailsLayer();
  scene.add(trailsLayer.group);

  // Continents (async)
  void loadContinents()
    .then((c) => scene.add(c))
    .catch((e: unknown) => console.warn('Continents:', e));

  const leader = new LeaderLine(leaderSvg, () => canvas);

  // Click → select aircraft
  function onClick(event: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const icao = findAircraftAtPointer(
      ndc,
      useAircraftStore.getState().aircraft.values(),
      camera,
      canvas
    );
    if (icao) {
      useSelectionStore.getState().select(icao);
      usePanelStore.getState().open('flight');
    } else {
      useSelectionStore.getState().select(null);
    }
  }
  canvas.addEventListener('click', onClick);

  // Resize
  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Render loop
  let rafId = 0;
  function animate(time: number): void {
    rafId = requestAnimationFrame(animate);
    controls.update();
    const t = time / 1000;
    globe.setTime(t);
    atmosphere.setTime(t);

    const aircraftMap = useAircraftStore.getState().aircraft;
    const selectedIcao = useSelectionStore.getState().selectedIcao;

    aircraftLayer.update(aircraftMap.values(), selectedIcao);
    trailsLayer.update(aircraftMap.values(), selectedIcao);

    // Leader line: only when an aircraft is selected and on the near hemisphere
    if (selectedIcao) {
      const ac = aircraftMap.get(selectedIcao);
      if (ac && ac.latitude !== null && ac.longitude !== null) {
        const world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
        const rect = panelEl.getBoundingClientRect();
        leader.update(world, camera, { x: rect.left, y: rect.top + 24 + 10 });
      } else {
        leader.clear();
      }
    } else {
      leader.clear();
    }

    renderer.render(scene, camera);
  }
  rafId = requestAnimationFrame(animate);

  return {
    dispose: () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointerdown', stopRotate);
      canvas.removeEventListener('wheel', stopRotate);
      renderer.dispose();
    },
  };
}
