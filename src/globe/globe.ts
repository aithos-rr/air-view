import { Color, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { GLOBE_RADIUS } from './geoHelpers';

export interface GlobeMesh {
  mesh: Mesh;
  setTime: (t: number) => void;
}

export function createGlobe(): GlobeMesh {
  const geometry = new SphereGeometry(GLOBE_RADIUS, 128, 128);

  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new Color(0x0b0e16) },
      uLimb: { value: new Color(0x8aa0c4) },
      uSpecTint: { value: new Color(0xbcd6ff) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec2 vUv;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDir    = normalize(-mv.xyz);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3  uDeep;
      uniform vec3  uLimb;
      uniform vec3  uSpecTint;
      varying vec3 vNormalView;
      varying vec3 vViewDir;
      varying vec2 vUv;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i),                  hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }
      float fnoise(vec2 p) { return 0.65 * noise(p) + 0.35 * noise(p * 2.3); }

      void main() {
        float NdotV   = clamp(abs(dot(vNormalView, vViewDir)), 0.0, 1.0);
        float fresnel = 1.0 - NdotV;
        vec3 baseColor = mix(uDeep, uLimb, pow(fresnel, 1.4));
        float limbZone = pow(fresnel, 1.8);
        float spec = fnoise(vUv * 6.0 + vec2(uTime * 0.012, uTime * 0.009));
        float specStrength = (spec - 0.45) * limbZone * 0.85;
        vec3 color = baseColor + specStrength * uSpecTint;
        float alpha = mix(0.28, 0.94, pow(fresnel, 1.1));
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;

  return {
    mesh,
    setTime: (t: number) => {
      const uTime = material.uniforms.uTime;
      if (uTime) uTime.value = t;
    },
  };
}
