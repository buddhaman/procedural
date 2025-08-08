export type TerrainParams = {
  seed: string;
  size: number;
  scale: number;
  baseFrequency: number;
  baseAmplitude: number;
  detailFrequency: number;
  detailAmplitude: number;
};

export type ChunkParams = TerrainParams & {
  chunkX: number;
  chunkZ: number;
  worldOffsetX: number;
  worldOffsetZ: number;
};

export type WorkerResult = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  colors?: Float32Array;
  waterMask?: Uint8Array;
  heights?: Float32Array;
  biomes?: string[]; // biome name for each vertex
  size: number;
  scale: number;
  chunkX: number;
  chunkZ: number;
};

export type ChunkCoord = {
  x: number;
  z: number;
};

export const CHUNK_SIZE = 64;
export const CHUNK_WORLD_SIZE = CHUNK_SIZE * 2;
export const RENDER_DISTANCE = 3;
export const WATER_LEVEL = 0;