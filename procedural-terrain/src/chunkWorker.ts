/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { createNoise2D } from 'simplex-noise';
import { ChunkParams, WorkerResult, CHUNK_SIZE, CHUNK_WORLD_SIZE, WATER_LEVEL } from './types';

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
  const vertexCount = chunkSize * chunkSize;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const waterMask = new Uint8Array(vertexCount);

  const useUint32 = vertexCount > 65535;
  const indices = useUint32
    ? new Uint32Array((chunkSize - 1) * (chunkSize - 1) * 6)
    : new Uint16Array((chunkSize - 1) * (chunkSize - 1) * 6);

  const rng = createSeededRng(seed);
  const noise2D = createNoise2D(rng);

  // Derive world vertex spacing from constants to match sampler and chunk placement
  const worldScale = CHUNK_WORLD_SIZE / (chunkSize - 1);

  // Generate positions with world coordinates
  for (let z = 0; z < chunkSize; z++) {
    for (let x = 0; x < chunkSize; x++) {
      const i = z * chunkSize + x;
      
      // World position for this vertex
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      
      // Use world coordinates for noise sampling to ensure continuity
      const nx = worldX * baseFrequency;
      const nz = worldZ * baseFrequency;
      const dx = worldX * detailFrequency;
      const dz = worldZ * detailFrequency;
      
      const baseHeight = baseAmplitude * noise2D(nx, nz);
      const detailHeight = detailAmplitude * noise2D(dx, dz);
      const height = baseHeight + detailHeight;

      // Store positions relative to chunk origin (chunk mesh is positioned at worldOffset)
      positions[i * 3 + 0] = x * worldScale;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = z * worldScale;

      // Generate terrain color based on height
      const [r, g, b] = getTerrainColor(height);
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Mark water areas
      waterMask[i] = height <= WATER_LEVEL ? 1 : 0;
    }
  }

  // Build indices and accumulate normals via face normals
  let ptr = 0;
  for (let z = 0; z < chunkSize - 1; z++) {
    for (let x = 0; x < chunkSize - 1; x++) {
      const a = z * chunkSize + x;
      const b = z * chunkSize + (x + 1);
      const d = (z + 1) * chunkSize + x;
      const c = (z + 1) * chunkSize + (x + 1);

      // Triangle 1: a, d, b
      indices[ptr++] = a as any;
      indices[ptr++] = d as any;
      indices[ptr++] = b as any;

      accumulateFaceNormal(positions, normals, a, d, b, chunkSize);

      // Triangle 2: b, d, c
      indices[ptr++] = b as any;
      indices[ptr++] = d as any;
      indices[ptr++] = c as any;

      accumulateFaceNormal(positions, normals, b, d, c, chunkSize);
    }
  }

  // Normalize accumulated vertex normals
  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[i * 3 + 0];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3 + 0] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }

  return {
    positions,
    normals,
    indices,
    colors,
    waterMask,
    size: chunkSize,
    scale: worldScale,
    chunkX,
    chunkZ,
  };
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