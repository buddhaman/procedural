/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { ChunkParams, WorkerResult, CHUNK_SIZE, CHUNK_WORLD_SIZE, WATER_LEVEL } from './types';
import { GeometryBuilder } from './GeometryBuilder';
import { BiomeGenerator, BiomeParams } from './BiomeGenerator';
import { VegetationSystem } from './VegetationSystem';

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function saturate(x: number): number { return Math.min(1, Math.max(0, x)); }

function buildChunkGeometry(params: ChunkParams): WorkerResult {
  const {
    seed,
    chunkX,
    chunkZ,
    worldOffsetX,
    worldOffsetZ,
  } = params;

  const chunkSize = CHUNK_SIZE;
  const worldScale = CHUNK_WORLD_SIZE / (chunkSize - 1);

  // Initialize biome generator
  const biomeGenerator = new BiomeGenerator(seed);

  // For flat shading, we need separate vertices for each triangle
  const triangleCount = (chunkSize - 1) * (chunkSize - 1) * 2;
  const vertexCount = triangleCount * 3;
  
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const waterMask = new Uint8Array(vertexCount);

  // Generate height and color grids using biome system
  const heightGrid: number[][] = [];
  const colorGridR: number[][] = [];
  const colorGridG: number[][] = [];
  const colorGridB: number[][] = [];
  const biomeParamsGrid: BiomeParams[][] = [];

  for (let z = 0; z < chunkSize; z++) {
    heightGrid[z] = [];
    colorGridR[z] = [];
    colorGridG[z] = [];
    colorGridB[z] = [];
    biomeParamsGrid[z] = [];
    
    for (let x = 0; x < chunkSize; x++) {
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      
      // Generate all biome parameters for this position
      const biomeParams = biomeGenerator.generateBiomeParams(worldX, worldZ);
      biomeParamsGrid[z][x] = biomeParams;
      
      // Get final height
      heightGrid[z][x] = biomeParams.finalHeight;
      
      // Get surface color
      const surfaceColor = biomeGenerator.getSurfaceColor(biomeParams);
      
      // Apply height-based shading
      const shade = saturate(0.85 + 0.15 * (biomeParams.finalHeight / 50));
      colorGridR[z][x] = saturate(surfaceColor[0] * shade);
      colorGridG[z][x] = saturate(surfaceColor[1] * shade);
      colorGridB[z][x] = saturate(surfaceColor[2] * shade);
    }
  }

  // Build triangles with flat shading (each triangle has unique vertices)
  let vertexIndex = 0;
  
  for (let z = 0; z < chunkSize - 1; z++) {
    for (let x = 0; x < chunkSize - 1; x++) {
      // Get the four corner heights
      const h00 = heightGrid[z][x];         // top-left
      const h10 = heightGrid[z][x + 1];     // top-right  
      const h01 = heightGrid[z + 1][x];     // bottom-left
      const h11 = heightGrid[z + 1][x + 1]; // bottom-right

      // World positions for the four corners
      const x00 = x * worldScale;
      const z00 = z * worldScale;
      const x10 = (x + 1) * worldScale;
      const z10 = z * worldScale;
      const x01 = x * worldScale;
      const z01 = (z + 1) * worldScale;
      const x11 = (x + 1) * worldScale;
      const z11 = (z + 1) * worldScale;

      // Triangle 1: (x,z) -> (x,z+1) -> (x+1,z)
      const r1 = (colorGridR[z][x] + colorGridR[z + 1][x] + colorGridR[z][x + 1]) / 3;
      const g1 = (colorGridG[z][x] + colorGridG[z + 1][x] + colorGridG[z][x + 1]) / 3;
      const b1 = (colorGridB[z][x] + colorGridB[z + 1][x] + colorGridB[z][x + 1]) / 3;
      const tri1Color: [number, number, number] = [r1, g1, b1];
      addFlatTriangle(positions, normals, colors, waterMask, vertexIndex,
        x00, h00, z00,  // vertex 0
        x01, h01, z01,  // vertex 1  
        x10, h10, z10,  // vertex 2
        tri1Color
      );
      vertexIndex += 3;

      // Triangle 2: (x+1,z) -> (x,z+1) -> (x+1,z+1)
      const r2 = (colorGridR[z][x + 1] + colorGridR[z + 1][x] + colorGridR[z + 1][x + 1]) / 3;
      const g2 = (colorGridG[z][x + 1] + colorGridG[z + 1][x] + colorGridG[z + 1][x + 1]) / 3;
      const b2 = (colorGridB[z][x + 1] + colorGridB[z + 1][x] + colorGridB[z + 1][x + 1]) / 3;
      const tri2Color: [number, number, number] = [r2, g2, b2];
      addFlatTriangle(positions, normals, colors, waterMask, vertexIndex,
        x10, h10, z10,  // vertex 0
        x01, h01, z01,  // vertex 1
        x11, h11, z11,  // vertex 2
        tri2Color
      );
      vertexIndex += 3;
    }
  }

  // Add vegetation using new multi-species system
  const vegetationBuilder = new GeometryBuilder();
  const vegetationSystem = new VegetationSystem(seed);
  
  // Create biome params lookup function
  const getBiomeParams = (x: number, y: number) => {
    const params = biomeGenerator.generateBiomeParams(x, y);
    // Get RBF weights for this location
    const weights = biomeGenerator.getBiomeWeights(params.temperature, params.moisture);
    return { params, weights };
  };
  
  // Place trees using priority Poisson system
  const trees = vegetationSystem.placeTrees(chunkX, chunkZ, chunkSize, worldScale, getBiomeParams);
  
  // Add trees to geometry
  for (const tree of trees) {
    // Convert world coordinates to local chunk coordinates
    const localX = tree.x - worldOffsetX;
    const localZ = tree.z - worldOffsetZ;
    
    if (tree.useLeaves && tree.leafSize > 0) {
      vegetationBuilder.addTreeWithLeaves(
        localX, tree.y, localZ,
        tree.size,
        tree.tilt,
        4, // depth
        Math.floor(tree.x * 1000 + tree.z * 1000) % 10000, // seed from position
        tree.leafSize,
        tree.leafColor
      );
    } else {
      vegetationBuilder.addTree(
        localX, tree.y, localZ,
        tree.size,
        tree.tilt,
        4, // depth
        Math.floor(tree.x * 1000 + tree.z * 1000) % 10000 // seed from position
      );
    }
  }
  
  // Add ground vegetation (bushes and grass)
  
  // Generate bushes between trees with lower density
  const bushDensity = 0.008; // Slightly lower density to make room for grass
  for (let attempt = 0; attempt < chunkSize * chunkSize * bushDensity; attempt++) {
    const randomSeed = Math.floor(Math.abs(Math.sin(seed.length * 123 + attempt * 456)) * 100000);
    const rng1 = Math.abs(Math.sin(randomSeed * 1.234)) % 1;
    const rng2 = Math.abs(Math.sin(randomSeed * 2.345)) % 1;
    const rng3 = Math.abs(Math.sin(randomSeed * 3.456)) % 1;
    
    const worldX = worldOffsetX + rng1 * CHUNK_WORLD_SIZE;
    const worldZ = worldOffsetZ + rng2 * CHUNK_WORLD_SIZE;
    const localX = worldX - worldOffsetX;
    const localZ = worldZ - worldOffsetZ;
    
    // Get biome parameters for this position
    const biomeParams = biomeGenerator.generateBiomeParams(worldX, worldZ);
    
    // Only place bushes in suitable biomes (not desert, not mountains, not ocean)
    const biomeName = biomeGenerator.getBiomeName(biomeParams);
    if (biomeName === 'desert' || biomeName === 'ocean' || biomeName === 'mountains') continue;
    
    // Check vegetation intensity
    const { weights } = getBiomeParams(worldX, worldZ);
    const vegIntensity = vegetationSystem.computeVegetationIntensity(worldX, worldZ, biomeParams, weights);
    
    // Skip if vegetation density is too low
    if (rng3 > vegIntensity * 0.3) continue; // Lower chance than trees
    
    // Make sure we're not too close to any trees
    let tooClose = false;
    for (const tree of trees) {
      const dist = Math.sqrt((worldX - tree.x) ** 2 + (worldZ - tree.z) ** 2);
      if (dist < 8) { // Minimum distance from trees
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    
    // Bush size based on biome moisture and temperature
    const bushSize = 1.2 + biomeParams.moisture * 1.5 + Math.abs(Math.sin(randomSeed * 4.567)) * 1.0;
    
    // Bush color based on biome
    const greenIntensity = 0.3 + biomeParams.moisture * 0.5;
    const tempModulation = (biomeParams.temperature - 0.5) * 0.2;
    const bushColor: [number, number, number] = [
      Math.max(0.1, Math.min(0.8, 0.2 + tempModulation)),
      Math.max(0.2, Math.min(0.9, greenIntensity)),
      Math.max(0.1, Math.min(0.6, 0.2 - tempModulation))
    ];
    
    vegetationBuilder.addBush(
      localX,
      biomeParams.finalHeight,
      localZ,
      bushSize,
      bushColor,
      randomSeed
    );
    
    // Debug log every 10th bush
    if (attempt % 10 === 0) {
      console.log(`Added bush at ${localX.toFixed(1)}, ${biomeParams.finalHeight.toFixed(1)}, ${localZ.toFixed(1)} in biome ${biomeName}`);
    }
  }
  
  // Generate grass patches with higher density
  const grassPatchDensity = 0.025; // Higher density for grass patches
  for (let attempt = 0; attempt < chunkSize * chunkSize * grassPatchDensity; attempt++) {
    const randomSeed = Math.floor(Math.abs(Math.sin(seed.length * 789 + attempt * 999)) * 100000);
    const rng1 = Math.abs(Math.sin(randomSeed * 5.678)) % 1;
    const rng2 = Math.abs(Math.sin(randomSeed * 6.789)) % 1;
    const rng3 = Math.abs(Math.sin(randomSeed * 7.890)) % 1;
    
    const worldX = worldOffsetX + rng1 * CHUNK_WORLD_SIZE;
    const worldZ = worldOffsetZ + rng2 * CHUNK_WORLD_SIZE;
    const localX = worldX - worldOffsetX;
    const localZ = worldZ - worldOffsetZ;
    
    // Get biome parameters for this position
    const biomeParams = biomeGenerator.generateBiomeParams(worldX, worldZ);
    const biomeName = biomeGenerator.getBiomeName(biomeParams);
    
    // Only place grass in suitable biomes (not desert, not ocean, prefer grasslands and forests)
    if (biomeName === 'desert' || biomeName === 'ocean' || biomeName === 'mountains') continue;
    
    // Check vegetation intensity
    const { weights } = getBiomeParams(worldX, worldZ);
    const vegIntensity = vegetationSystem.computeVegetationIntensity(worldX, worldZ, biomeParams, weights);
    
    // Skip if vegetation density is too low (grass is more tolerant)
    if (rng3 > vegIntensity * 0.8) continue; // Higher tolerance for grass
    
    // Make sure we're not too close to trees or bushes (but allow closer than bushes)
    let tooClose = false;
    for (const tree of trees) {
      const dist = Math.sqrt((worldX - tree.x) ** 2 + (worldZ - tree.z) ** 2);
      if (dist < 4) { // Smaller minimum distance for grass
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    
    // Bigger grass patch properties  
    const patchSize = 6.0 + biomeParams.moisture * 4.0 + Math.abs(Math.sin(randomSeed * 8.901)) * 3.0; // Much bigger (6-13 units)
    const grassDensity = 8 + biomeParams.moisture * 12; // Good density for large patches without overwhelming
    
    // Grass color based on biome - more vibrant greens
    const baseGreen = 0.5 + biomeParams.moisture * 0.4;
    const temperatureEffect = (biomeParams.temperature - 0.5) * 0.15;
    const grassColor: [number, number, number] = [
      Math.max(0.1, Math.min(0.6, 0.2 + temperatureEffect)),
      Math.max(0.3, Math.min(0.95, baseGreen)),
      Math.max(0.1, Math.min(0.4, 0.15 - temperatureEffect))
    ];
    
    vegetationBuilder.addGrassPatch(
      localX,
      biomeParams.finalHeight,
      localZ,
      patchSize,
      grassDensity,
      grassColor,
      randomSeed
    );
    
    // Debug log every 20th grass patch
    if (attempt % 20 === 0) {
      console.log(`Added grass patch at ${localX.toFixed(1)}, ${biomeParams.finalHeight.toFixed(1)}, ${localZ.toFixed(1)} in biome ${biomeName}`);
    }
  }
  
  // Get static vegetation geometry (branches)
  const staticVegGeometry = vegetationBuilder.getStaticGeometry();
  
  // Get dynamic vegetation geometry (leaves/bushes with wind data)
  const dynamicVegGeometry = vegetationBuilder.getDynamicGeometry();
  
  // Debug logging
  console.log(`Chunk ${chunkX},${chunkZ}: Trees: ${trees.length}, Dynamic vertices: ${dynamicVegGeometry.positions.length / 3}, Static vertices: ${staticVegGeometry.positions.length / 3}`);
  
  // Combine terrain and static vegetation geometry
  const combinedPositions = new Float32Array(positions.length + staticVegGeometry.positions.length);
  const combinedNormals = new Float32Array(normals.length + staticVegGeometry.normals.length);
  const combinedColors = new Float32Array(colors.length + staticVegGeometry.colors.length);
  const combinedWaterMask = new Uint8Array(waterMask.length + staticVegGeometry.positions.length / 3);
  
  // Copy terrain data
  combinedPositions.set(positions);
  combinedNormals.set(normals);
  combinedColors.set(colors);
  combinedWaterMask.set(waterMask);
  
  // Copy static vegetation data (branches)
  combinedPositions.set(staticVegGeometry.positions, positions.length);
  combinedNormals.set(staticVegGeometry.normals, normals.length);
  combinedColors.set(staticVegGeometry.colors, colors.length);
  // Vegetation is above water, so set water mask to 0
  for (let i = 0; i < staticVegGeometry.positions.length / 3; i++) {
    combinedWaterMask[waterMask.length + i] = 0;
  }

  // No indices needed for flat shading - we use the vertices directly
  const indices = new Uint16Array(0);

  // Flatten height grid to Float32Array for collision sampling (single source of truth)
  const heights = new Float32Array(chunkSize * chunkSize);
  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      heights[z * chunkSize + x] = heightGrid[z][x];
    }
  }

  return {
    positions: combinedPositions,
    normals: combinedNormals,
    indices,
    colors: combinedColors,
    waterMask: combinedWaterMask,
    heights,
    size: chunkSize,
    scale: worldScale,
    chunkX,
    chunkZ,
    // Dynamic vegetation data (leaves/bushes)
    dynamicPositions: dynamicVegGeometry.positions,
    dynamicNormals: dynamicVegGeometry.normals,
    dynamicColors: dynamicVegGeometry.colors,
    dynamicWindData: dynamicVegGeometry.windData,
  };
}


function addFlatTriangle(
  positions: Float32Array,
  normals: Float32Array, 
  colors: Float32Array,
  waterMask: Uint8Array,
  startIndex: number,
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  color: [number, number, number]
) {
  // Calculate face normal
  const v1x = x1 - x0;
  const v1y = y1 - y0;
  const v1z = z1 - z0;
  
  const v2x = x2 - x0;
  const v2y = y2 - y0;
  const v2z = z2 - z0;
  
  // Cross product for normal
  const nx = v1y * v2z - v1z * v2y;
  const ny = v1z * v2x - v1x * v2z;
  const nz = v1x * v2y - v1y * v2x;
  
  // Normalize
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const normalX = nx / len;
  const normalY = ny / len; 
  const normalZ = nz / len;

  // Add three vertices with same normal and color
  for (let i = 0; i < 3; i++) {
    const idx = (startIndex + i) * 3;
    
    // Set position
    if (i === 0) {
      positions[idx + 0] = x0;
      positions[idx + 1] = y0;
      positions[idx + 2] = z0;
    } else if (i === 1) {
      positions[idx + 0] = x1;
      positions[idx + 1] = y1;
      positions[idx + 2] = z1;
    } else {
      positions[idx + 0] = x2;
      positions[idx + 1] = y2;
      positions[idx + 2] = z2;
    }
    
    // Set normal (same for all vertices in triangle)
    normals[idx + 0] = normalX;
    normals[idx + 1] = normalY;
    normals[idx + 2] = normalZ;
    
    // Set color (same for all vertices in triangle)  
    colors[idx + 0] = color[0];
    colors[idx + 1] = color[1];
    colors[idx + 2] = color[2];
    
    // Set water mask
    const height = i === 0 ? y0 : i === 1 ? y1 : y2;
    waterMask[startIndex + i] = height <= WATER_LEVEL ? 1 : 0;
  }
}

function accumulateFaceNormal(
  positions: Float32Array,
  normals: Float32Array,
  ia: number,
  ib: number,
  ic: number,
  size: number
) {
  const ax = positions[ia * 3 + 0];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];

  const bx = positions[ib * 3 + 0];
  const by = positions[ib * 3 + 1];
  const bz = positions[ib * 3 + 2];

  const cx = positions[ic * 3 + 0];
  const cy = positions[ic * 3 + 1];
  const cz = positions[ic * 3 + 2];

  // Edges
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;

  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  // Cross product AB x AC
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  normals[ia * 3 + 0] += nx;
  normals[ia * 3 + 1] += ny;
  normals[ia * 3 + 2] += nz;

  normals[ib * 3 + 0] += nx;
  normals[ib * 3 + 1] += ny;
  normals[ib * 3 + 2] += nz;

  normals[ic * 3 + 0] += nx;
  normals[ic * 3 + 1] += ny;
  normals[ic * 3 + 2] += nz;
}

self.onmessage = (ev: MessageEvent<ChunkParams>) => {
  const params = ev.data;
  const result = buildChunkGeometry(params);
  
  // Transfer buffers to avoid cloning cost
  const transferables = [
    result.positions.buffer,
    result.normals.buffer,
    result.indices.buffer,
  ];
  
  if (result.colors) {
    transferables.push(result.colors.buffer);
  }
  
  if (result.waterMask) {
    transferables.push(result.waterMask.buffer);
  }
  
  // Add dynamic vegetation buffers
  if (result.dynamicPositions) {
    transferables.push(result.dynamicPositions.buffer);
  }
  if (result.dynamicNormals) {
    transferables.push(result.dynamicNormals.buffer);
  }
  if (result.dynamicColors) {
    transferables.push(result.dynamicColors.buffer);
  }
  if (result.dynamicWindData) {
    transferables.push(result.dynamicWindData.buffer);
  }
  
  (postMessage as any)(result, transferables);
};