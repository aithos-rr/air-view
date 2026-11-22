import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createGlobe } from './globe';
import { createAtmosphere } from './atmosphere';
import { loadContinents } from './continents';
import { createAircraftLayer } from './aircraft';
import type { FrameState } from './aircraft';
import { createTrailsLayer } from './trails';
import { createFocusFade } from './focus';
import { attachUserTakeover, createFocusCamera } from './focusCamera';
import { createRouteArcLayer } from './routeArc';
import { createAirportMarkers } from './airportMarkers';
import { LeaderLine } from './leaderLine';
import { findAircraftAtPointer } from './raycaster';
import { advanceFor, positionAt } from './deadReckoning';
import {
  CAMERA_FAR_LIMIT,
  CAMERA_NEAR_LIMIT,
  latLonAltToVec3,
  vec3ToLatLon,
  visibleCapRadiusNm,
} from './geoHelpers';
import { useAircraftStore } from '@/state/aircraftStore';
import { useSelectionStore } from '@/state/selectionStore';
import { usePanelStore } from '@/state/panelStore';
import { useA11yStore } from '@/state/a11yStore';
import { readVisibilityRule, readFocusAct, readFocusView, markerSpecs } from '@/state/sceneView';

export interface ViewCentre {
  lat: number;
  lon: number;
  radiusNm: number;
}

export interface SceneHandle {
  dispose: () => void;
  viewCentre: () => ViewCentre;
}

export function mountScene(
  canvas: HTMLCanvasElement,
  leaderSvg: SVGElement,
  panelEl: HTMLElement,
  markersEl: HTMLElement
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
  // One declaration for the travel, shared with pointSizePx and with the
  // marker label threshold. The near end is the tile grid's number, not a
  // taste: see CAMERA_NEAR_LIMIT (D24).
  controls.minDistance = CAMERA_NEAR_LIMIT;
  controls.maxDistance = CAMERA_FAR_LIMIT;
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

  /**
   * The camera's journey to a flight the user asked to be taken to, and
   * every decision around it: when to begin one, when to abandon it, and
   * what the panel may say about the flight meanwhile (D34).
   *
   * All of that used to be written out inside animate() and inside a
   * listener on this canvas — which is to say inside the one part of this
   * application no unit test can reach. Six planted mutants proved what
   * that cost: each inverted a choice the user had just made and left all
   * 612 tests green. The loop now CALLS the decision instead of making it.
   */
  const focusCamera = createFocusCamera({
    stopAutoRotate: stopRotate,
    publishSightline: (v) => useSelectionStore.getState().setFocusSightline(v),
    // A flight already in focus when this scene mounts is not a new act of
    // focusing, and nobody has just asked for this view to move.
    focusSeqAtMount: useSelectionStore.getState().focusSeq,
  });
  const releaseToUser = attachUserTakeover(canvas, focusCamera);

  // Layers
  const atmosphere = createAtmosphere();
  scene.add(atmosphere.mesh);
  const globe = createGlobe();
  scene.add(globe.mesh);
  const aircraftLayer = createAircraftLayer();
  scene.add(aircraftLayer.group);
  const trailsLayer = createTrailsLayer();
  scene.add(trailsLayer.group);
  const arcLayer = createRouteArcLayer();
  scene.add(arcLayer.group);
  const markers = createAirportMarkers(markersEl, (end) => {
    useSelectionStore.getState().openAirport(end);
    usePanelStore.getState().open('flight');
  });

  // Continents (async)
  void loadContinents()
    .then((c) => scene.add(c))
    .catch((e: unknown) => console.warn('Continents:', e));

  const leader = new LeaderLine(leaderSvg, () => canvas);
  const focusFade = createFocusFade();

  // Where the last click landed, so a second click on the SAME pixel can
  // mean "the next one" instead of "the same one again" (D26). Four pixels:
  // a bigger movement is a new target, not a second attempt.
  let lastClickPx: { x: number; y: number } | null = null;
  const SAME_SPOT_PX = 4;

  // Click → select aircraft
  function onClick(event: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const px = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const sameSpot =
      lastClickPx !== null &&
      Math.abs(px.x - lastClickPx.x) <= SAME_SPOT_PX &&
      Math.abs(px.y - lastClickPx.y) <= SAME_SPOT_PX;
    lastClickPx = px;
    const icao = findAircraftAtPointer(
      ndc,
      useAircraftStore.getState().aircraft.values(),
      camera,
      canvas,
      readVisibilityRule(),
      // performance.now() and the rAF timestamp share an origin, so a click
      // handler can ask the same question the last frame asked.
      (() => {
        const s = useAircraftStore.getState();
        const at = performance.now();
        return {
          nowMs: at,
          elapsedSinceBatchS: s.feedStampMs === 0 ? 0 : (at - s.feedStampMs) / 1000,
          cameraDistance: camera.position.length(),
          stale: s.feedStale,
        };
      })()
    ,
      sameSpot ? useSelectionStore.getState().selectedIcao : null
    );
    if (icao) {
      // 'globe': they pointed at this aircraft with the cursor, so the
      // camera does not move. Taking away the view they chose in order to
      // show them what they were already looking at is the one thing D34
      // forbids.
      useSelectionStore.getState().select(icao, 'globe');
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

  // --- Per-frame profiler -----------------------------------------------------
  // Logs once per second: actual fps + average ms in each pipeline stage.
  // Disable by setting window.__AIR_VIEW_PROFILE = false.
  interface ProfileWindow extends Window {
    __AIR_VIEW_PROFILE?: boolean;
    /** See AircraftLayer.probeHead — one reader, tests/e2e/density-motion.spec.ts. */
    __airViewProbe?: () => number[];
    /**
     * Where the camera is: the point it sits over, and how far out it is.
     *
     * One reader, tests/e2e/camera-on-focus.spec.ts. Whether the camera
     * travelled is not observable from the DOM — the D/A markers follow the
     * airports and not the flight, and the "behind the globe" note is only
     * ever about the far side — so the browser needs the camera itself to
     * tell the two halves of D34 apart.
     */
    __airViewCamera?: () => { lat: number; lon: number; distance: number };
  }
  const profileWindow = window as ProfileWindow;
  // Behind the profiler's own switch, so a page that has turned the
  // instrumentation off carries no debug surface at all. Assigned once at
  // mount rather than per frame: sixty writes a second to the same closure
  // would buy nothing.
  if (profileWindow.__AIR_VIEW_PROFILE !== false) {
    profileWindow.__airViewProbe = () => aircraftLayer.probeHead();
    profileWindow.__airViewCamera = () => ({
      ...vec3ToLatLon(camera.position),
      distance: camera.position.length(),
    });
  }
  let frames = 0;
  let lastFpsLog = performance.now();
  let acTotal = 0;
  let trailsTotal = 0;
  let leaderTotal = 0;
  let renderTotal = 0;

  // One scratch object for the leader line, declared outside animate():
  // one object per frame here would be sixty allocations a second for
  // nothing.
  const leaderScratch = { x: 0, y: 0, z: 0 };

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

    // `time` is the rAF timestamp and feedStampMs is a performance.now()
    // reading: the two share performance.timeOrigin by specification, so
    // this subtraction is a real monotonic duration. Date.now() against
    // lastContact would be the same mistake v1 made in removeStale, where
    // a frozen feed made every aircraft look infinitely stale (D21).
    const feed = useAircraftStore.getState();
    const frame: FrameState = {
      nowMs: time,
      // feedStampMs is the instant the batch was BUILT, projected onto this
      // browser's monotonic clock, so this grows with the time that really
      // passed even while the server serves the same body again (D31).
      elapsedSinceBatchS: feed.feedStampMs === 0 ? 0 : (time - feed.feedStampMs) / 1000,
      cameraDistance: camera.position.length(),
      stale: feed.feedStale,
    };

    const rule = readVisibilityRule();

    const subject = rule.focusedIcao === null ? null : aircraftMap.get(rule.focusedIcao);
    // Where that one aircraft is, computed once and read by both the turn
    // and the declaration below it. rule.focusedIcao is granted only to an
    // aircraft isFocusable() can place, so this is null exactly when there
    // is no subject to speak about.
    const subjectWorld =
      subject != null && subject.latitude !== null && subject.longitude !== null
        ? latLonAltToVec3(subject.latitude, subject.longitude, subject.baroAltitudeFt ?? 38000)
        : null;

    // --- The camera brings the flight into view (D34) ------------------------
    // Before anything in this frame reads the camera, so the dots, the
    // leader line, the markers and the sentence about the far side all
    // describe the SAME camera. `time` is the rAF timestamp: monotonic, the
    // clock focus.ts and the dead reckoning already measure on.
    //
    // Every decision is focusCamera's — whether to begin a journey, whether
    // to abandon one, what the panel may say while it runs. What is left
    // here is the one thing a unit test could never do anyway: putting the
    // camera where the answer says.
    const here = focusCamera.step({
      // The camera itself, position AND lens: what counts as "already on
      // screen" is the cap the lens frames, not the hemisphere (D34).
      // camera.fov is fixed at 38 here, but reading it from the camera is
      // what keeps this and viewCentre() agreeing.
      camera,
      subjectWorld,
      // The idle spin stops for a flight in focus even when that flight
      // cannot be placed, which is why this is not `subjectWorld !== null`.
      inFocus: rule.focusedIcao !== null,
      ...readFocusAct(),
      nowMs: time,
      reducedMotion: useA11yStore.getState().prefersReducedMotion,
    });
    if (here !== null) {
      camera.position.copy(here);
      // The orbit target, which enablePan keeps at the origin. Everything
      // else in this file — viewCentre(), the leader line, the markers —
      // assumes the camera looks at the centre of the globe.
      camera.lookAt(controls.target);
      // The projections further down happen BEFORE renderer.render()
      // refreshes this for us, and a frame that draws from a stale
      // matrix is the dot you can see and cannot click (D29).
      camera.updateMatrixWorld();
    }
    // frame.cameraDistance above is still right: a turn rotates and never
    // changes how far out the camera sits, which is what makes the zoom
    // the user's alone (D34).
    // `time` is the rAF timestamp: monotonic by specification. Date.now()
    // moves by ~528 ms every ~32 s on this machine, which would end a 300 ms
    // fade before it began.
    const othersBrightness = focusFade.sample(
      rule.focusedIcao,
      time,
      useA11yStore.getState().prefersReducedMotion
    );
    const tAC = performance.now();
    aircraftLayer.update(aircraftMap.values(), selectedIcao, rule, othersBrightness, frame);
    const tTr = performance.now();
    trailsLayer.update(aircraftMap.values(), selectedIcao, rule);
    const focusView = readFocusView();
    arcLayer.update(focusView?.arc ?? null);
    markers.update(markerSpecs(focusView), camera, canvas.clientWidth, canvas.clientHeight);
    const tLd = performance.now();

    // Leader line: only when an aircraft is selected and on the near hemisphere
    if (selectedIcao) {
      const ac = aircraftMap.get(selectedIcao);
      if (ac && ac.latitude !== null && ac.longitude !== null) {
        // The line points at the DOT. Starting it at the fix would leave
        // it indicating beside the aircraft by up to 25 px at the deepest
        // zoom (D29).
        // The line points at the DOT, through the same advanceFor the walk
        // and the picker ask, so the three cannot disagree about where this
        // aircraft is on this frame (D29/D31).
        let world: Vector3;
        if (ac.motion == null) {
          world = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
        } else {
          positionAt(
            ac.motion,
            advanceFor(ac.motion, frame.elapsedSinceBatchS, frame.stale),
            time,
            leaderScratch
          );
          world = new Vector3(leaderScratch.x, leaderScratch.y, leaderScratch.z);
        }
        const rect = panelEl.getBoundingClientRect();
        leader.update(world, camera, { x: rect.left, y: rect.top + 24 + 10 });
      } else {
        leader.clear();
      }
    } else {
      leader.clear();
    }

    const tRn = performance.now();
    renderer.render(scene, camera);
    const tEnd = performance.now();

    acTotal += tTr - tAC;
    trailsTotal += tLd - tTr;
    leaderTotal += tRn - tLd;
    renderTotal += tEnd - tRn;
    frames++;

    const now = performance.now();
    if (now - lastFpsLog >= 1000) {
      if (profileWindow.__AIR_VIEW_PROFILE !== false) {
        const fps = frames;
        // eslint-disable-next-line no-console
        console.log(
          `[air-view] ${fps} fps · ${aircraftMap.size} aircraft · ` +
            `aircraft ${(acTotal / fps).toFixed(2)}ms · ` +
            `trails ${(trailsTotal / fps).toFixed(2)}ms · ` +
            `leader ${(leaderTotal / fps).toFixed(2)}ms · ` +
            `render ${(renderTotal / fps).toFixed(2)}ms`
        );
      }
      frames = 0;
      acTotal = 0;
      trailsTotal = 0;
      leaderTotal = 0;
      renderTotal = 0;
      lastFpsLog = now;
    }
  }
  rafId = requestAnimationFrame(animate);

  return {
    dispose: () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      releaseToUser();
      markers.dispose();
      renderer.dispose();
    },
    viewCentre: () => {
      // The camera always looks at the origin, so the point under it is the
      // normalised camera direction. The radius is what the lens actually
      // shows — horizon AND frustum. With the horizon alone this returned
      // between 3 602 and 4 886 NM across the entire zoom range, every value
      // above the server's ceiling, so the server saw one constant and the
      // zoom level never travelled.
      const { lat, lon } = vec3ToLatLon(camera.position);
      return {
        lat,
        lon,
        radiusNm: visibleCapRadiusNm(camera.position.length(), camera.fov),
      };
    },
  };
}
