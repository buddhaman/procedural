import * as THREE from 'three';

export function createWindMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute float windInfluence;
      
      uniform float time;
      uniform vec3 windDirection;
      uniform float windStrength;
      uniform float windSpeed;
      uniform float windTurbulence;
      
      varying vec3 vColor;
      varying vec3 vNormal;
      
      // Simplex noise function for organic movement
      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }
      
      vec4 mod289(vec4 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }
      
      vec4 permute(vec4 x) {
        return mod289(((x * 34.0) + 1.0) * x);
      }
      
      vec4 taylorInvSqrt(vec4 r) {
        return 1.79284291400159 - 0.85373472095314 * r;
      }
      
      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        
        vec3 i = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min(g.xyz, l.zxy);
        vec3 i2 = max(g.xyz, l.zxy);
        
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        
        i = mod289(i);
        vec4 p = permute(permute(permute(
                 i.z + vec4(0.0, i1.z, i2.z, 1.0))
               + i.y + vec4(0.0, i1.y, i2.y, 1.0))
               + i.x + vec4(0.0, i1.x, i2.x, 1.0));
               
        float n_ = 0.142857142857;
        vec3 ns = n_ * D.wyz - D.xzx;
        
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_);
        
        vec4 x = x_ * ns.x + ns.yyyy;
        vec4 y = y_ * ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        
        vec4 b0 = vec4(x.xy, y.xy);
        vec4 b1 = vec4(x.zw, y.zw);
        
        vec4 s0 = floor(b0) * 2.0 + 1.0;
        vec4 s1 = floor(b1) * 2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        
        vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
        
        vec3 p0 = vec3(a0.xy, h.x);
        vec3 p1 = vec3(a0.zw, h.y);
        vec3 p2 = vec3(a1.xy, h.z);
        vec3 p3 = vec3(a1.zw, h.w);
        
        vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;
        
        vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
      }
      
      void main() {
        vec3 transformed = position;
        
        // Apply wind effect based on windInfluence attribute
        if (windInfluence > 0.0) {
          // Create complex wind motion with multiple octaves
          float timeOffset = time * windSpeed;
          
          // Primary wind wave - large scale movement
          float primaryWave = sin(timeOffset + position.x * 0.05 + position.z * 0.03) * 0.5 + 0.5;
          
          // Secondary turbulence - medium scale
          float turbulence1 = snoise(vec3(position.x * 0.1, position.z * 0.1, timeOffset * 0.3));
          
          // Fine detail turbulence - small scale
          float turbulence2 = snoise(vec3(position.x * 0.2, position.z * 0.2, timeOffset * 0.7)) * 0.5;
          
          // Vertical component for natural sway
          float verticalSway = sin(timeOffset * 1.2 + position.y * 0.1) * 0.3;
          
          // Combine wind effects
          float windEffect = (primaryWave + turbulence1 * windTurbulence + turbulence2 * windTurbulence * 0.5 + verticalSway) * windStrength;
          
          // Apply directional wind with some cross-wind turbulence
          vec3 windOffset = windDirection * windEffect;
          windOffset.x += turbulence1 * windStrength * 0.3; // Cross-wind X
          windOffset.z += turbulence2 * windStrength * 0.3; // Cross-wind Z
          
          // Scale by wind influence (higher parts of leaves move more)
          windOffset *= windInfluence;
          
          // Apply wind displacement
          transformed += windOffset;
        }
        
        vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        
        // Pass color and normal to fragment shader
        vColor = color;
        vNormal = normalize(normalMatrix * normal);
      }
    `,
    
    fragmentShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      
      uniform vec3 lightDirection;
      uniform vec3 lightColor;
      uniform vec3 ambientColor;
      uniform float time;
      
      void main() {
        // Simple directional lighting
        vec3 normal = normalize(vNormal);
        float lightDot = max(0.0, dot(normal, -lightDirection));
        
        // Combine ambient and directional lighting
        vec3 lighting = ambientColor + lightColor * lightDot;
        
        // Apply lighting to vertex color
        vec3 finalColor = vColor * lighting;
        
        // Add a subtle color pulse to show the shader is working
        float pulse = 0.1 * sin(time * 2.0) + 0.9;
        finalColor *= pulse;
        
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    
    uniforms: {
      time: { value: 0.0 },
      windDirection: { value: new THREE.Vector3(1.0, 0.0, 0.3).normalize() },
      windStrength: { value: 0.8 }, // Gentle wind movement
      windSpeed: { value: 1.2 }, // Slower, more natural animation
      windTurbulence: { value: 0.6 }, // Subtle turbulence
      lightDirection: { value: new THREE.Vector3(100, -100, 50).normalize() }, // Match scene directional light
      lightColor: { value: new THREE.Color(1.0, 1.0, 1.0) }, // White like scene
      ambientColor: { value: new THREE.Color(0.6, 0.65, 0.7) } // Match scene ambient + hemisphere
    },
    
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: false
  });
}

// Utility function to update wind parameters
export function updateWindUniforms(material: THREE.ShaderMaterial, time: number, options?: {
  windDirection?: THREE.Vector3,
  windStrength?: number,
  windSpeed?: number,
  windTurbulence?: number,
  lightDirection?: THREE.Vector3,
  lightColor?: THREE.Color,
  ambientColor?: THREE.Color
}) {
  material.uniforms.time.value = time;
  
  if (options?.windDirection) {
    material.uniforms.windDirection.value.copy(options.windDirection);
  }
  if (options?.windStrength !== undefined) {
    material.uniforms.windStrength.value = options.windStrength;
  }
  if (options?.windSpeed !== undefined) {
    material.uniforms.windSpeed.value = options.windSpeed;
  }
  if (options?.windTurbulence !== undefined) {
    material.uniforms.windTurbulence.value = options.windTurbulence;
  }
  
  // Update lighting to match scene lighting
  if (options?.lightDirection) {
    material.uniforms.lightDirection.value.copy(options.lightDirection);
  }
  if (options?.lightColor) {
    material.uniforms.lightColor.value.copy(options.lightColor);
  }
  if (options?.ambientColor) {
    material.uniforms.ambientColor.value.copy(options.ambientColor);
  }
}