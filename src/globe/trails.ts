import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
} from 'three';
import type { Aircraft } from '@/types';
import { latLonAltToVec3 } from './geoHelpers';

const CRUISING_BASE: [number, number, number] = [1.0, 0.902, 0.769];
const SELECTED_BASE: [number, number, number] = [0.16, 0.59, 1.0];

export interface TrailsLayer {
  group: Group;
  update: (aircraft: Iterable<Aircraft>, selectedIcao: string | null) => void;
}

/**
 * Builds one `Line` per aircraft with quadratic alpha decay from head (current
 * position) to tail (oldest trail point). Trails store ~5s of history via
 * aircraftStore's trail buffer (capped at 30 points). Lines are rebuilt
 * each frame: at most a few hundred aircraft are visible at once.
 */
export function createTrailsLayer(): TrailsLayer {
  const group = new Group();
  const lines = new Map<string, Line>();

  function ensureLine(icao: string): Line {
    let line = lines.get(icao);
    if (!line) {
      const geom = new BufferGeometry();
      const mat = new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      line = new Line(geom, mat);
      line.renderOrder = 3;
      group.add(line);
      lines.set(icao, line);
    }
    return line;
  }

  function update(aircraft: Iterable<Aircraft>, selectedIcao: string | null): void {
    const alive = new Set<string>();
    for (const ac of aircraft) {
      if (ac.latitude === null || ac.longitude === null) continue;
      if (ac.trail.length < 1) continue;

      alive.add(ac.icao24);
      const base = ac.icao24 === selectedIcao ? SELECTED_BASE : CRUISING_BASE;
      const positions: number[] = [];
      const colors: number[] = [];

      // Trail (oldest → newest) + current position at the end
      const trail = ac.trail.slice();
      trail.push({ lon: ac.longitude, lat: ac.latitude, t: ac.lastContact });
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        if (!p) continue;
        const pos = latLonAltToVec3(p.lat, p.lon, ac.baroAltitudeFt ?? 38000);
        positions.push(pos.x, pos.y, pos.z);
        const t = i / Math.max(1, trail.length - 1); // 0 oldest → 1 newest (head)
        // Quadratic decay: opaque at head, transparent at tail
        const a = t * t;
        colors.push(base[0] * a, base[1] * a, base[2] * a);
      }

      const line = ensureLine(ac.icao24);
      line.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      line.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    }

    // Remove lines for aircraft no longer in feed
    for (const [icao, line] of lines) {
      if (!alive.has(icao)) {
        group.remove(line);
        line.geometry.dispose();
        (line.material as LineBasicMaterial).dispose();
        lines.delete(icao);
      }
    }
  }

  return { group, update };
}
