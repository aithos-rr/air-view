import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Points,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import type { Aircraft } from '@/types';
import { GLOBE_RADIUS } from './geoHelpers';

const CRUISING_COLOR: [number, number, number] = [1.0, 0.902, 0.769]; // #ffe6c4
const SELECTED_COLOR: [number, number, number] = [0.16, 0.59, 1.0]; // sky-leaning Action Blue
const DEG = Math.PI / 180;
// Sized for the global feed (~14 000 aircraft) + headroom.
// Memory cost: 18 000 × (3 + 3 + 1) × 4 B ≈ 500 KB. Trascurabile.
const MAX_AIRCRAFT = 18000;
const SCENE_BOUND_RADIUS = GLOBE_RADIUS + 0.5;

interface PointParams {
  size: number;
  coreLum: number;
  haloFalloff: number;
  haloWidth: number;
}

function createPointMaterial(p: PointParams): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSize: { value: p.size },
      uCoreLum: { value: p.coreLum },
      uHaloFalloff: { value: p.haloFalloff },
      uHaloWidth: { value: p.haloWidth },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aHeading;
      varying vec3 vColor;
      varying float vHeading;
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        vColor   = aColor;
        vHeading = aHeading;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float s = uSize * uPixelRatio * (4.0 / -mv.z);
        gl_PointSize = clamp(s, 6.0, 220.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uCoreLum;
      uniform float uHaloFalloff;
      uniform float uHaloWidth;
      varying vec3 vColor;
      varying float vHeading;
      float sdEllipse(vec2 p, vec2 r) { return length(p / r) - 1.0; }
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float distCentre = length(uv);
        float c = cos(vHeading);
        float s = sin(vHeading);
        vec2 obj = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);
        float fuselage = sdEllipse(obj, vec2(0.04, 0.28));
        float wings    = sdEllipse(obj - vec2(0.0, -0.04), vec2(0.30, 0.06));
        float tail     = sdEllipse(obj - vec2(0.0,  0.20), vec2(0.10, 0.04));
        float plane = min(min(fuselage, wings), tail);
        float silhouette = 1.0 - smoothstep(-0.006, 0.020, plane);
        float halo = exp(-distCentre * uHaloWidth) * uHaloFalloff;
        float circleMask = smoothstep(0.65, 0.45, distCentre);
        float bodyLum = silhouette * uCoreLum;
        float intensity = max(bodyLum, halo * 0.5) * circleMask;
        if (intensity < 0.005) discard;
        vec3 col = mix(vColor, vec3(1.0), clamp(silhouette * 0.45, 0.0, 0.80));
        gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}

interface PointSet {
  geom: BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  headings: Float32Array;
  positionAttr: BufferAttribute;
  colorAttr: BufferAttribute;
  headingAttr: BufferAttribute;
}

function createPointSet(capacity: number): PointSet {
  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const headings = new Float32Array(capacity);
  const geom = new BufferGeometry();
  const positionAttr = new BufferAttribute(positions, 3);
  positionAttr.setUsage(DynamicDrawUsage);
  const colorAttr = new BufferAttribute(colors, 3);
  colorAttr.setUsage(DynamicDrawUsage);
  const headingAttr = new BufferAttribute(headings, 1);
  headingAttr.setUsage(DynamicDrawUsage);
  geom.setAttribute('position', positionAttr);
  geom.setAttribute('aColor', colorAttr);
  geom.setAttribute('aHeading', headingAttr);
  geom.boundingSphere = new Sphere(new Vector3(0, 0, 0), SCENE_BOUND_RADIUS);
  return { geom, positions, colors, headings, positionAttr, colorAttr, headingAttr };
}

// Inline lat/lon/alt → xyz. Zero allocations per call.
function writeLatLonAlt(
  buf: Float32Array,
  offset: number,
  lat: number,
  lon: number,
  altFt: number
): void {
  const radius = GLOBE_RADIUS + 0.025 + (Math.max(0, altFt) / 41000) * 0.05;
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = lon * (Math.PI / 180);
  const sinPhi = Math.sin(phi);
  buf[offset] = radius * sinPhi * Math.sin(theta);
  buf[offset + 1] = radius * Math.cos(phi);
  buf[offset + 2] = radius * sinPhi * Math.cos(theta);
}

export interface AircraftLayer {
  group: Group;
  update: (aircraft: Iterable<Aircraft>, selectedIcao: string | null) => void;
}

export function createAircraftLayer(): AircraftLayer {
  const group = new Group();

  const cruisingSet = createPointSet(MAX_AIRCRAFT);
  const cruisingMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const cruisingPts = new Points(cruisingSet.geom, cruisingMat);
  cruisingPts.renderOrder = 3;
  cruisingPts.frustumCulled = false;
  group.add(cruisingPts);

  const selectedSet = createPointSet(8); // at most a handful selected (v1 = exactly 1)
  const selectedMat = createPointMaterial({
    size: 56,
    coreLum: 2.0,
    haloFalloff: 1.35,
    haloWidth: 6.5,
  });
  const selectedPts = new Points(selectedSet.geom, selectedMat);
  selectedPts.renderOrder = 4;
  selectedPts.frustumCulled = false;
  group.add(selectedPts);

  function update(aircraft: Iterable<Aircraft>, selectedIcao: string | null): void {
    let cruisingCount = 0;
    let selectedCount = 0;

    for (const ac of aircraft) {
      if (ac.latitude === null || ac.longitude === null) continue;
      const headingRad = (ac.headingDeg ?? 0) * DEG;
      const altFt = ac.baroAltitudeFt ?? 38000;
      const isSel = ac.icao24 === selectedIcao;

      if (isSel) {
        if (selectedCount >= MAX_AIRCRAFT) continue;
        const i = selectedCount;
        writeLatLonAlt(selectedSet.positions, i * 3, ac.latitude, ac.longitude, altFt);
        selectedSet.colors[i * 3] = SELECTED_COLOR[0];
        selectedSet.colors[i * 3 + 1] = SELECTED_COLOR[1];
        selectedSet.colors[i * 3 + 2] = SELECTED_COLOR[2];
        selectedSet.headings[i] = headingRad;
        selectedCount++;
      } else {
        if (cruisingCount >= MAX_AIRCRAFT) continue;
        const i = cruisingCount;
        writeLatLonAlt(cruisingSet.positions, i * 3, ac.latitude, ac.longitude, altFt);
        cruisingSet.colors[i * 3] = CRUISING_COLOR[0];
        cruisingSet.colors[i * 3 + 1] = CRUISING_COLOR[1];
        cruisingSet.colors[i * 3 + 2] = CRUISING_COLOR[2];
        cruisingSet.headings[i] = headingRad;
        cruisingCount++;
      }
    }

    cruisingSet.geom.setDrawRange(0, cruisingCount);
    cruisingSet.positionAttr.needsUpdate = true;
    cruisingSet.colorAttr.needsUpdate = true;
    cruisingSet.headingAttr.needsUpdate = true;

    selectedSet.geom.setDrawRange(0, selectedCount);
    selectedSet.positionAttr.needsUpdate = true;
    selectedSet.colorAttr.needsUpdate = true;
    selectedSet.headingAttr.needsUpdate = true;
  }

  return { group, update };
}
