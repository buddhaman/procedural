import * as THREE from 'three';

export function createWindMaterial(): THREE.MeshLambertMaterial {
  // Create a custom MeshLambertMaterial that handles wind in onBeforeCompile
  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: false
  });

  // Add custom uniforms for wind
  material.uniforms = {
    time: { value: 0.0 },
    windDirection: { value: new THREE.Vector3(1.0, 0.0, 0.3).normalize() },
    windStrength: { value: 0.8 },
    windSpeed: { value: 1.2 },
    windTurbulence: { value: 0.6 }
  };

  // Modify the shader during compilation
  material.onBeforeCompile = (shader) => {
    // Add wind uniforms to the shader
    Object.assign(shader.uniforms, material.uniforms);
    
    // Add wind attribute declaration
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      attribute float windInfluence;
      uniform float time;
      uniform vec3 windDirection;
      uniform float windStrength;
      uniform float windSpeed;
      uniform float windTurbulence;
      `
    );

    // Add wind deformation but preserve normals
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      
      // Store original position before wind
      vec3 originalPosition = transformed;
      
      // Apply wind deformation
      if (windInfluence > 0.0) {
        float noise1 = sin(time * windSpeed + originalPosition.x * 0.1 + originalPosition.z * 0.05) * 0.5 + 0.5;
        float noise2 = sin(time * windSpeed * 0.7 + originalPosition.x * 0.15) * 0.3;
        float windEffect = (noise1 + noise2 * windTurbulence) * windStrength * windInfluence;
        
        vec3 windOffset = windDirection * windEffect;
        windOffset.x += noise2 * windStrength * windInfluence * 0.3;
        windOffset.z += noise1 * windStrength * windInfluence * 0.3;
        
        transformed += windOffset;
      }
      `
    );

    // Ensure normals are processed correctly after deformation
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      #include <beginnormal_vertex>
      // Keep original normals - they're computed per-face for flat shading
      // Wind deformation shouldn't change the face normals significantly
      `
    );
  };

  return material;
}

// Utility function to update wind parameters
export function updateWindUniforms(material: THREE.MeshLambertMaterial, time: number, options?: {
  windDirection?: THREE.Vector3,
  windStrength?: number,
  windSpeed?: number,
  windTurbulence?: number
}) {
  if (!material.uniforms) return;
  
  material.uniforms.time.value = time;
  
  if (options?.windDirection && material.uniforms.windDirection) {
    material.uniforms.windDirection.value.copy(options.windDirection);
  }
  if (options?.windStrength !== undefined && material.uniforms.windStrength) {
    material.uniforms.windStrength.value = options.windStrength;
  }
  if (options?.windSpeed !== undefined && material.uniforms.windSpeed) {
    material.uniforms.windSpeed.value = options.windSpeed;
  }
  if (options?.windTurbulence !== undefined && material.uniforms.windTurbulence) {
    material.uniforms.windTurbulence.value = options.windTurbulence;
  }
  // Lighting is now handled automatically by MeshLambertMaterial
}