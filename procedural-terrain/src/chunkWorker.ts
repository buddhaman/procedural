/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { ChunkParams, WorkerResult, CHUNK_SIZE, CHUNK_WORLD_SIZE, WATER_LEVEL } from './types';
import { GeometryBuilder } from './GeometryBuilder';
import { BiomeGenerator, BiomeParams } from './BiomeGenerator';

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

  // Add vegetation using biome-based placement
  const vegetationBuilder = new GeometryBuilder();
  addVegetation(vegetationBuilder, heightGrid, biomeParamsGrid, chunkSize, worldScale, worldOffsetX, worldOffsetZ, biomeGenerator);
  
  // Get vegetation geometry
  const vegGeometry = vegetationBuilder.getGeometry();
  
  // Combine terrain and vegetation geometry
  const combinedPositions = new Float32Array(positions.length + vegGeometry.positions.length);
  const combinedNormals = new Float32Array(normals.length + vegGeometry.normals.length);
  const combinedColors = new Float32Array(colors.length + vegGeometry.colors.length);
  const combinedWaterMask = new Uint8Array(waterMask.length + vegGeometry.positions.length / 3);
  
  // Copy terrain data
  combinedPositions.set(positions);
  combinedNormals.set(normals);
  combinedColors.set(colors);
  combinedWaterMask.set(waterMask);
  
  // Copy vegetation data
  combinedPositions.set(vegGeometry.positions, positions.length);
  combinedNormals.set(vegGeometry.normals, normals.length);
  combinedColors.set(vegGeometry.colors, colors.length);
  // Vegetation is above water, so set water mask to 0
  for (let i = 0; i < vegGeometry.positions.length / 3; i++) {
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
  };
}

function addVegetation(
  builder: GeometryBuilder,
  heightGrid: number[][],
  biomeParamsGrid: BiomeParams[][],
  chunkSize: number,
  worldScale: number,
  worldOffsetX: number,
  worldOffsetZ: number,
  biomeGenerator: BiomeGenerator
) {
  // Sample vegetation at lower resolution to avoid too many trees
  const vegSampleRate = 8; // Every 8th vertex
  
  for (let z = 0; z < chunkSize; z += vegSampleRate) {
    for (let x = 0; x < chunkSize; x += vegSampleRate) {
      if (x >= chunkSize || z >= chunkSize) continue;
      
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      const height = heightGrid[z][x];
      const biomeParams = biomeParamsGrid[z][x];
      
      // Only place vegetation above water level
      if (height <= WATER_LEVEL + 1) continue;
      
      // Get biome name for vegetation type
      const biomeName = biomeGenerator.getBiomeName(biomeParams);
      
      // Biome-specific vegetation placement
      const vegetationSeed = Math.floor((worldX * 1000 + worldZ * 1000) % 10000);
      const vegRandom = (Math.sin(vegetationSeed) * 10000) % 1;
      
      // Different vegetation rules per biome - CONSISTENT TREE SIZES
      let treeDensity = 0;
      let bushDensity = 0;
      const baseTreeHeight = 4; // Fixed base height for all trees
      let treeColor: [number, number, number] = [0.4, 0.2, 0.1];
      let leafColor: [number, number, number] = [0.2, 0.5, 0.1];
      
      switch (biomeName) {
        case 'forest':
          treeDensity = 0.4;
          bushDensity = 0.2;
          treeColor = [0.3, 0.15, 0.05];
          leafColor = [0.1, 0.4, 0.1];
          break;
          
        case 'plains':
          treeDensity = 0.05;
          bushDensity = 0.15;
          leafColor = [0.2, 0.6, 0.1];
          break;
          
        case 'desert':
          treeDensity = 0.01;
          bushDensity = 0.05;
          leafColor = [0.4, 0.3, 0.1]; // Cactus-like
          break;
          
        case 'mountains':
          treeDensity = 0.1;
          bushDensity = 0.05;
          leafColor = [0.2, 0.4, 0.3]; // Hardy mountain trees
          break;
          
        case 'tundra':
          treeDensity = 0.02;
          bushDensity = 0.03;
          leafColor = [0.3, 0.4, 0.3]; // Sparse, hardy vegetation
          break;
          
        default: // ocean
          continue; // No vegetation in ocean
      }
      
      // Place trees - CONSISTENT SIZE
      if (vegRandom < treeDensity) {
        const treeSeed = Math.floor((worldX * 1000 + worldZ * 1000) % 10000);
        
        builder.addTree(
          x * worldScale,
          height,
          z * worldScale,
          baseTreeHeight, // Same height for all trees!
          (treeSeed % 1000) / 1000 * Math.PI * 2,
          4, // Fractal depth
          treeSeed
        );
      }
      // Place bushes where no trees
      else if (vegRandom < treeDensity + bushDensity) {
        const bushHeight = 1.0; // Fixed bush height
        const bushColor: [number, number, number] = [
          leafColor[0] * 0.8,
          leafColor[1] * 0.8,
          leafColor[2] * 0.8
        ];
        
        builder.addBeam(
          [x * worldScale, height, z * worldScale],
          [x * worldScale, height + bushHeight, z * worldScale],
          0.3,
          0.2,
          bushColor,
          6
        );
      }
    }
  }
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
  
  (postMessage as any)(result, transferables);
};