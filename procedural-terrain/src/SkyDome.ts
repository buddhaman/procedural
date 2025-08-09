import * as THREE from 'three';

type SkyUniforms = {
  time: { value: number };
  sunDirection: { value: THREE.Vector3 };
  zenithColor: { value: THREE.Color };
  horizonColor: { value: THREE.Color };
  nightColor: { value: THREE.Color };
  cloudColor: { value: THREE.Color };
  cloudCoverage: { value: number };
  cloudSharpness: { value: number };
  cloudScale: { value: number };
  cloudSpeed: { value: number };
};

export function createSkyDome(radius: number = 1500) {
  const uniforms: SkyUniforms = {
    time: { value: 0 },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    zenithColor: { value: new THREE.Color(0x6fb7ff) },
    horizonColor: { value: new THREE.Color(0xf1c27d) },
    nightColor: { value: new THREE.Color(0x0b0f1a) },
    cloudColor: { value: new THREE.Color(0xffffff) },
    cloudCoverage: { value: 0.42 },
    cloudSharpness: { value: 0.85 },
    cloudScale: { value: 0.00075 },
    cloudSpeed: { value: 0.005 },
  };

  const vertexShader = `
    varying vec3 vWorldDir;
    void main() {
      // Position is already a sphere around origin; use normal as direction
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldDir = normalize(worldPos.xyz - cameraPosition);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  const fragmentShader = `
    precision mediump float;
    varying vec3 vWorldDir;

    uniform float time;
    uniform vec3 sunDirection;
    uniform vec3 zenithColor;
    uniform vec3 horizonColor;
    uniform vec3 nightColor;
    uniform vec3 cloudColor;
    uniform float cloudCoverage;
    uniform float cloudSharpness;
    uniform float cloudScale;
    uniform float cloudSpeed;

    // Hash and noise helpers
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.03; a *= 0.5;
      }
      return v;
    }

    // Smooth max between two values
    float smax(float a, float b, float k) {
      float h = clamp(0.5 + 0.5*(b - a)/k, 0.0, 1.0);
      return mix(a, b, h) + k*h*(1.0-h);
    }

    void main() {
      // Elevation of current ray
      float y = clamp(vWorldDir.y, -1.0, 1.0);

      // Sun parameters
      float sunDot = clamp(dot(normalize(vWorldDir), normalize(sunDirection)), -1.0, 1.0);
      float sunDisk = smoothstep(0.995, 1.0, sunDot); // slightly larger core
      float sunGlow = smoothstep(0.92, 1.0, sunDot);  // broader halo

      // Day-night factor from sun elevation
      float sunElev = clamp(sunDirection.y * 0.5 + 0.5, 0.0, 1.0);
      float dayFactor = smoothstep(0.02, 0.10, sunElev); // 0 at night, 1 at day

      // Base sky gradient
      vec3 daySky = mix(horizonColor, zenithColor, pow(max(y*0.5+0.5, 0.0), 1.2));
      vec3 nightSky = mix(nightColor * 0.6, nightColor, 1.0 - (y*0.5+0.5));
      vec3 skyCol = mix(nightSky, daySky, dayFactor);

      // Clouds: project direction to a plane and animate
      vec2 uv = normalize(vWorldDir.xz) * (abs(vWorldDir.y) + 0.2);
      uv *= cloudScale * 2000.0; // scale with dome radius notionally
      uv += vec2(time * cloudSpeed, time * cloudSpeed * 0.6);
      float c = fbm(uv);
      // Shape the coverage: higher coverage -> more clouds
      float cov = cloudCoverage;
      float shaped = smoothstep(cov, cov + (1.0 - cov) * (1.0 - cloudSharpness), c);
      // Dim clouds at night
      float cloudLight = mix(0.2, 1.0, dayFactor);
      vec3 cloudCol = cloudColor * cloudLight;
      skyCol = mix(skyCol, cloudCol, shaped * 0.65);

      // Add sun
      vec3 sunCol = mix(vec3(1.0, 0.85, 0.55), vec3(1.0, 0.95, 0.8), dayFactor);
      float sunIntensity = 1.5 * dayFactor;
      skyCol += sunCol * (sunGlow * 0.6 + sunDisk * sunIntensity);

      // Simple stars at night
      if (dayFactor < 0.2) {
        vec2 sp = vWorldDir.xz * 120.0;
        float star = step(0.995, noise(sp + time * 0.01));
        skyCol += vec3(star) * (0.8 * (0.2 - dayFactor));
      }

      gl_FragColor = vec4(skyCol, 1.0);
    }
  `;

  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as any,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const geometry = new THREE.SphereGeometry(radius, 64, 48);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return { mesh, uniforms };
}
