/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { createNoise2D } from 'simplex-noise';
import { ChunkParams, WorkerResult, CHUNK_SIZE, CHUNK_WORLD_SIZE, WATER_LEVEL } from './types';
import { GeometryBuilder } from './GeometryBuilder';

function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRng(seed: string) {
  const seedFn = xmur3(seed);
  const rng = mulberry32(seedFn());
  return rng;
}

function getTerrainColor(height: number): [number, number, number] {
  if (height < WATER_LEVEL - 2) {
    // Deep water/sand
    return [0.8, 0.7, 0.5];
  } else if (height < WATER_LEVEL + 2) {
    // Beach/shallow
    return [0.9, 0.8, 0.6];
  } else if (height < 15) {
    // Grass
    return [0.3, 0.6, 0.2];
  } else if (height < 30) {
    // Forest
    return [0.2, 0.4, 0.1];
  } else {
    // Mountain/rock
    return [0.5, 0.5, 0.5];
  }
}

function buildChunkGeometry(params: ChunkParams): WorkerResult {
  const {
    seed,
    size,
    scale,
    baseFrequency,
    baseAmplitude,
    detailFrequency,
    detailAmplitude,
    chunkX,
    chunkZ,
    worldOffsetX,
    worldOffsetZ,
  } = params;

  // Use CHUNK_SIZE instead of params.size for consistent chunk dimensions
  const chunkSize = CHUNK_SIZE;
  
  const rng = createSeededRng(seed);
  const noise2D = createNoise2D(rng);

  // Derive world vertex spacing from constants to match sampler and chunk placement
  const worldScale = CHUNK_WORLD_SIZE / (chunkSize - 1);

  // For flat shading, we need separate vertices for each triangle
  // Each quad becomes 2 triangles, each triangle gets 3 unique vertices
  const triangleCount = (chunkSize - 1) * (chunkSize - 1) * 2;
  const vertexCount = triangleCount * 3;
  
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const waterMask = new Uint8Array(vertexCount);

  // Generate height grid first
  const heightGrid: number[][] = [];
  for (let z = 0; z < chunkSize; z++) {
    heightGrid[z] = [];
    for (let x = 0; x < chunkSize; x++) {
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      
      const nx = worldX * baseFrequency;
      const nz = worldZ * baseFrequency;
      const dx = worldX * detailFrequency;
      const dz = worldZ * detailFrequency;
      
      const baseHeight = baseAmplitude * noise2D(nx, nz);
      const detailHeight = detailAmplitude * noise2D(dx, dz);
      heightGrid[z][x] = baseHeight + detailHeight;
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
      const tri1Color = getTerrainColor((h00 + h01 + h10) / 3); // Average height for triangle color
      addFlatTriangle(positions, normals, colors, waterMask, vertexIndex,
        x00, h00, z00,  // vertex 0
        x01, h01, z01,  // vertex 1  
        x10, h10, z10,  // vertex 2
        tri1Color
      );
      vertexIndex += 3;

      // Triangle 2: (x+1,z) -> (x,z+1) -> (x+1,z+1)
      const tri2Color = getTerrainColor((h10 + h01 + h11) / 3); // Average height for triangle color
      addFlatTriangle(positions, normals, colors, waterMask, vertexIndex,
        x10, h10, z10,  // vertex 0
        x01, h01, z01,  // vertex 1
        x11, h11, z11,  // vertex 2
        tri2Color
      );
      vertexIndex += 3;
    }
  }

  // Add vegetation using noise-based placement
  const vegetationBuilder = new GeometryBuilder();
  addVegetation(vegetationBuilder, heightGrid, chunkSize, worldScale, worldOffsetX, worldOffsetZ, noise2D);
  
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

  return {
    positions: combinedPositions,
    normals: combinedNormals,
    indices,
    colors: combinedColors,
    waterMask: combinedWaterMask,
    size: chunkSize,
    scale: worldScale,
    chunkX,
    chunkZ,
  };
}

function addVegetation(
  builder: GeometryBuilder,
  heightGrid: number[][],
  chunkSize: number,
  worldScale: number,
  worldOffsetX: number,
  worldOffsetZ: number,
  noise2D: any
) {
  // Sample vegetation at lower resolution to avoid too many trees
  const vegSampleRate = 8; // Every 8th vertex
  
  for (let z = 0; z < chunkSize; z += vegSampleRate) {
    for (let x = 0; x < chunkSize; x += vegSampleRate) {
      if (x >= chunkSize || z >= chunkSize) continue;
      
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      const height = heightGrid[z][x];
      
      // Only place vegetation above water level and on reasonable slopes
      if (height <= WATER_LEVEL + 1) continue;
      
      // Use noise to determine vegetation placement
      const vegNoise = noise2D(worldX * 0.02, worldZ * 0.02);
      const treeDensityThreshold = 0.3; // Adjust for more/fewer trees
      
      if (vegNoise > treeDensityThreshold) {
        // Determine tree type and size based on height and noise
        const treeHeight = 3 + (height * 0.1) + (vegNoise * 2);
        const treeSeed = Math.floor((worldX * 1000 + worldZ * 1000) % 10000);
        
        // Add a fractal tree
        builder.addTree(
          x * worldScale,
          height,
          z * worldScale,
          Math.min(treeHeight, 8), // Cap tree height
          (treeSeed % 1000) / 1000 * Math.PI * 2, // Seeded angle
          4, // Fractal depth
          treeSeed
        );
      }
      
      // Add smaller vegetation (bushes) with different noise
      const bushNoise = noise2D(worldX * 0.05, worldZ * 0.05);
      if (bushNoise > 0.4 && vegNoise <= treeDensityThreshold) {
        const bushHeight = 0.5 + bushNoise * 1.5;
        const bushSeed = Math.floor((worldX * 500 + worldZ * 500) % 10000);
        
        // Add small bush (single beam with some randomness)
        const bushColor: [number, number, number] = [
          0.2 + bushNoise * 0.3,
          0.4 + bushNoise * 0.4,
          0.1
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