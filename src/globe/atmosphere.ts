import { AdditiveBlending, BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { GLOBE_RADIUS } from './geoHelpers';

export interface AtmosphereMesh {
  mesh: Mesh;
  setTime: (t: number) => void;
}

export function createAtmosphere(): AtmosphereMesh {
  const geometry = new SphereGeometry(GLOBE_RADIUS * 1.04, 64, 64);
  const material = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir    = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      void main() {
        float fresnel = 1.0 - clamp(dot(vNormalView, vViewDir), 0.0, 1.0);
        fresnel = pow(fresnel, 2.5);
        vec3 haloColor = vec3(0.42, 0.55, 0.78);
        gl_FragColor = vec4(haloColor, fresnel * 0.18);
      }
    `,
    transparent: true,
    side: BackSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 0;
  return {
    mesh,
    setTime: (t: number) => {
      const uTime = material.uniforms.uTime;
      if (uTime) uTime.value = t;
    },
  };
}
