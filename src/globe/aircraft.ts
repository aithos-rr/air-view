import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Points,
  ShaderMaterial,
} from 'three';
import type { Aircraft } from '@/types';
import { latLonAltToVec3 } from './geoHelpers';

const CRUISING_COLOR: [number, number, number] = [1.0, 0.902, 0.769]; // #ffe6c4
const SELECTED_COLOR: [number, number, number] = [0.16, 0.59, 1.0];   // sky-leaning Action Blue
const DEG = Math.PI / 180;

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

export interface AircraftLayer {
  group: Group;
  update: (aircraft: Iterable<Aircraft>, selectedIcao: string | null) => void;
}

export function createAircraftLayer(): AircraftLayer {
  const group = new Group();

  const cruisingGeom = new BufferGeometry();
  cruisingGeom.setAttribute('position', new Float32BufferAttribute([], 3));
  cruisingGeom.setAttribute('aColor', new Float32BufferAttribute([], 3));
  cruisingGeom.setAttribute('aHeading', new Float32BufferAttribute([], 1));
  const cruisingMat = createPointMaterial({ size: 26, coreLum: 1.6, haloFalloff: 0.9, haloWidth: 11 });
  const cruisingPts = new Points(cruisingGeom, cruisingMat);
  cruisingPts.renderOrder = 3;
  group.add(cruisingPts);

  const selectedGeom = new BufferGeometry();
  selectedGeom.setAttribute('position', new Float32BufferAttribute([], 3));
  selectedGeom.setAttribute('aColor', new Float32BufferAttribute([], 3));
  selectedGeom.setAttribute('aHeading', new Float32BufferAttribute([], 1));
  const selectedMat = createPointMaterial({
    size: 56,
    coreLum: 2.0,
    haloFalloff: 1.35,
    haloWidth: 6.5,
  });
  const selectedPts = new Points(selectedGeom, selectedMat);
  selectedPts.renderOrder = 4;
  group.add(selectedPts);

  function update(aircraft: Iterable<Aircraft>, selectedIcao: string | null): void {
    const cruisingPos: number[] = [];
    const cruisingCol: number[] = [];
    const cruisingHdg: number[] = [];
    const selPos: number[] = [];
    const selCol: number[] = [];
    const selHdg: number[] = [];

    for (const ac of aircraft) {
      if (ac.latitude === null || ac.longitude === null) continue;
      const pos = latLonAltToVec3(ac.latitude, ac.longitude, ac.baroAltitudeFt ?? 38000);
      const headingRad = (ac.headingDeg ?? 0) * DEG;
      const isSel = ac.icao24 === selectedIcao;
      if (isSel) {
        selPos.push(pos.x, pos.y, pos.z);
        selCol.push(...SELECTED_COLOR);
        selHdg.push(headingRad);
      } else {
        cruisingPos.push(pos.x, pos.y, pos.z);
        cruisingCol.push(...CRUISING_COLOR);
        cruisingHdg.push(headingRad);
      }
    }

    cruisingGeom.setAttribute('position', new Float32BufferAttribute(cruisingPos, 3));
    cruisingGeom.setAttribute('aColor', new Float32BufferAttribute(cruisingCol, 3));
    cruisingGeom.setAttribute('aHeading', new Float32BufferAttribute(cruisingHdg, 1));

    selectedGeom.setAttribute('position', new Float32BufferAttribute(selPos, 3));
    selectedGeom.setAttribute('aColor', new Float32BufferAttribute(selCol, 3));
    selectedGeom.setAttribute('aHeading', new Float32BufferAttribute(selHdg, 1));
  }

  return { group, update };
}
