import * as THREE from 'three';

export const waterVertexShader = `
  uniform float time;
  uniform float waveStrength;
  uniform float waveFrequency;
  
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  void main() {
    vUv = uv;
    
    // Calculate world position
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    // Create waves
    float wave1 = sin(worldPosition.x * waveFrequency + time) * waveStrength;
    float wave2 = sin(worldPosition.z * waveFrequency * 0.8 + time * 0.7) * waveStrength * 0.6;
    float wave3 = sin((worldPosition.x + worldPosition.z) * waveFrequency * 1.2 + time * 1.3) * waveStrength * 0.4;
    
    worldPosition.y += wave1 + wave2 + wave3;
    
    // Calculate normal for lighting
    float dx = cos(worldPosition.x * waveFrequency + time) * waveStrength * waveFrequency;
    float dz = cos(worldPosition.z * waveFrequency * 0.8 + time * 0.7) * waveStrength * 0.6 * waveFrequency * 0.8;
    
    vec3 normal = normalize(vec3(-dx, 1.0, -dz));
    vNormal = normalize(normalMatrix * normal);
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const waterFragmentShader = `
  uniform float time;
  uniform vec3 waterColor;
  uniform vec3 deepWaterColor;
  uniform float opacity;
  uniform float fresnelPower;
  uniform vec3 cameraPosition;
  
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  varying vec2 vUv;
  
  // Simplex noise function
  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  
  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }
  
  vec4 permute(vec4 x) {
       return mod289(((x*34.0)+1.0)*x);
  }
  
  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }
  
  float snoise(vec3 v) {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
    
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;
    
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );
    
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    
    i = mod289(i);
    vec4 p = permute( permute( permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
             
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_ );
    
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    
    vec4 b0 = vec4( x.xy, y.xy );
    vec4 b1 = vec4( x.zw, y.zw );
    
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
    
    vec3 p0 = vec3(a0.xy,h.x);
    vec3 p1 = vec3(a0.zw,h.y);
    vec3 p2 = vec3(a1.xy,h.z);
    vec3 p3 = vec3(a1.zw,h.w);
    
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;
    
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
  }
  
  void main() {
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vNormal);
    
    // Add some surface detail with noise
    float noise1 = snoise(vec3(vWorldPosition.x * 0.1, vWorldPosition.z * 0.1, time * 0.5));
    float noise2 = snoise(vec3(vWorldPosition.x * 0.05, vWorldPosition.z * 0.05, time * 0.3));
    
    // Perturb normal for surface detail
    vec3 perturbedNormal = normalize(normal + vec3(noise1 * 0.1, 0.0, noise2 * 0.1));
    
    // Fresnel effect - more transparent when looking straight down
    float fresnel = pow(1.0 - max(0.0, dot(viewDirection, perturbedNormal)), fresnelPower);
    
    // Mix water colors based on fresnel and depth
    vec3 color = mix(waterColor, deepWaterColor, fresnel * 0.7);
    
    // Add some foam/sparkle effect
    float foam = max(0.0, snoise(vec3(vWorldPosition.x * 0.2, vWorldPosition.z * 0.2, time * 2.0)));
    foam = pow(foam, 3.0) * 0.3;
    color = mix(color, vec3(0.9, 0.95, 1.0), foam);
    
    // Final opacity based on fresnel
    float finalOpacity = opacity * (0.4 + fresnel * 0.6);
    
    gl_FragColor = vec4(color, finalOpacity);
  }
`;

export function createWaterMaterial(waterLevel: number = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0.0 },
      waterColor: { value: new THREE.Color(0.2, 0.6, 0.9) },
      deepWaterColor: { value: new THREE.Color(0.0, 0.2, 0.4) },
      opacity: { value: 0.8 },
      fresnelPower: { value: 2.0 },
      waveStrength: { value: 0.2 },
      waveFrequency: { value: 0.05 },
      cameraPosition: { value: new THREE.Vector3() },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}