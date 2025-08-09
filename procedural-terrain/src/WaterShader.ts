import * as THREE from 'three';

export const waterVertexShader = `
  precision mediump float;
  
  uniform float time;
  uniform float waveStrength;
  uniform float waveFrequency;
  
  // Pass raw position to fragment for flat shading
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  
  void main() {
    // Store local position for flat shading calculations
    vPosition = position;
    
    // Calculate world position
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    // Simple wave animation
    float wave = sin(worldPosition.x * waveFrequency + time) * waveStrength;
    wave += sin(worldPosition.z * waveFrequency * 0.7 + time * 0.8) * waveStrength * 0.5;
    worldPosition.y += wave;
    
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const waterFragmentShader = `
  precision mediump float;
  
  uniform vec3 shallowWaterColor;
  uniform vec3 deepWaterColor;
  uniform float opacity;
  uniform float time;
  uniform float baseFrequency;
  uniform float baseAmplitude;
  uniform float detailFrequency;
  uniform float detailAmplitude;
  
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  
  // Simplified noise function for terrain height estimation
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  
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
  
  // Approximate terrain height using same noise as terrain generation
  float getTerrainHeight(vec2 worldPos) {
    float nx = worldPos.x * baseFrequency;
    float nz = worldPos.y * baseFrequency;
    float dx = worldPos.x * detailFrequency;
    float dz = worldPos.y * detailFrequency;
    
    float baseHeight = baseAmplitude * (noise(vec2(nx, nz)) * 2.0 - 1.0);
    float detailHeight = detailAmplitude * (noise(vec2(dx, dz)) * 2.0 - 1.0);
    
    return baseHeight + detailHeight;
  }
  
  void main() {
    // Calculate approximate terrain height at this water position
    float terrainHeight = getTerrainHeight(vWorldPosition.xz);
    
    // Water depth = water level (0) - terrain height
    float waterDepth = 0.0 - terrainHeight;
    
    // Sharp transitions based on actual water depth
    vec3 color;
    if (waterDepth < 2.0) {
      // Shallow water (near shore/beach)
      color = shallowWaterColor;
    } else {
      // Deep water
      color = deepWaterColor;
    }
    
    gl_FragColor = vec4(color, opacity);
  }
`;

export function createWaterMaterial(waterLevel: number = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      shallowWaterColor: { value: new THREE.Color(0.4, 0.8, 0.9) }, // Light blue-cyan
      deepWaterColor: { value: new THREE.Color(0.1, 0.4, 0.7) },     // Darker blue
      opacity: { value: 0.8 },
      waveStrength: { value: 0.1 },
      waveFrequency: { value: 0.03 },
      time: { value: 0.0 },
      // Terrain noise parameters (should match terrain generation)
      baseFrequency: { value: 0.02 },
      baseAmplitude: { value: 20.0 },
      detailFrequency: { value: 0.1 },
      detailAmplitude: { value: 3.0 },
    },
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    // True flat shading
  });
}