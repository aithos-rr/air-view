import type { Camera, Vector3 } from 'three';
import { Vector3 as V3 } from 'three';

const LINE_COLOR = 'rgba(41, 151, 255, 0.55)'; // sky blue 55% alpha
const DASH = '4 4';

export interface PanelTarget {
  x: number;
  y: number;
}

export class LeaderLine {
  constructor(private svg: SVGElement, private getCanvas: () => HTMLCanvasElement) {}

  update(worldPos: Vector3, camera: Camera, panelTarget: PanelTarget): void {
    // Hide if aircraft is on the far hemisphere of the globe
    const camDir = camera.position.clone().normalize();
    const acDir = worldPos.clone().normalize();
    if (camDir.dot(acDir) <= 0.05) {
      this.clear();
      return;
    }
    const canvas = this.getCanvas();
    const projected = new V3().copy(worldPos).project(camera);
    const halfW = canvas.clientWidth / 2;
    const halfH = canvas.clientHeight / 2;
    const sx = projected.x * halfW + halfW;
    const sy = -projected.y * halfH + halfH;
    this.svg.innerHTML =
      `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" ` +
      `x2="${panelTarget.x}" y2="${panelTarget.y}" ` +
      `stroke="${LINE_COLOR}" stroke-width="1" stroke-dasharray="${DASH}" />`;
  }

  clear(): void {
    if (this.svg.innerHTML !== '') this.svg.innerHTML = '';
  }
}
