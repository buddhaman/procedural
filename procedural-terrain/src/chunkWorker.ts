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

type BiomePrototype = {
  name: string;
  t: number; // temperature center [0..1]
  m: number; // moisture center [0..1]
  ridgedWeight: number; // 0 billowy .. 1 ridged
  amplitudeScale: number; // overall amplitude multiplier
  detailScale: number; // detail amplitude multiplier
  baseColor: [number, number, number];
  baseFreqScale: number; // frequency multiplier for base terrain (lower = wider features)
  detailFreqScale: number; // frequency multiplier for detail noise
};

const BIOMES: BiomePrototype[] = [
  // Flat/low terrain biomes - higher frequencies for smaller features
  { name: 'desert',   t: 0.9, m: 0.1, ridgedWeight: 0.1, amplitudeScale: 0.5, detailScale: 0.2, baseColor: [0.86, 0.78, 0.58], baseFreqScale: 1.0, detailFreqScale: 1.0 },
  { name: 'savanna',  t: 0.8, m: 0.3, ridgedWeight: 0.2, amplitudeScale: 0.6, detailScale: 0.3, baseColor: [0.72, 0.68, 0.35], baseFreqScale: 1.0, detailFreqScale: 1.0 },
  { name: 'grass',    t: 0.7, m: 0.5, ridgedWeight: 0.2, amplitudeScale: 0.5, detailScale: 0.4, baseColor: [0.28, 0.62, 0.26], baseFreqScale: 1.0, detailFreqScale: 1.0 },
  
  // Medium terrain biomes - moderate frequencies
  { name: 'forest',   t: 0.6, m: 0.75, ridgedWeight: 0.35, amplitudeScale: 0.8, detailScale: 0.5, baseColor: [0.2, 0.44, 0.18], baseFreqScale: 0.7, detailFreqScale: 0.9 },
  { name: 'rain',     t: 0.85, m: 0.9, ridgedWeight: 0.4, amplitudeScale: 0.7, detailScale: 0.6, baseColor: [0.15, 0.5, 0.2], baseFreqScale: 0.8, detailFreqScale: 1.0 },
  { name: 'taiga',    t: 0.35, m: 0.55, ridgedWeight: 0.5, amplitudeScale: 1.0, detailScale: 0.4, baseColor: [0.22, 0.5, 0.38], baseFreqScale: 0.6, detailFreqScale: 0.8 },
  
  // Mountain biomes - extremely low frequencies for massive, wide mountain ranges
  { name: 'tundra',   t: 0.2, m: 0.3, ridgedWeight: 0.8, amplitudeScale: 8.0, detailScale: 0.4, baseColor: [0.6, 0.6, 0.6], baseFreqScale: 0.08, detailFreqScale: 0.5 },
  { name: 'alpine',   t: 0.1, m: 0.4, ridgedWeight: 0.98, amplitudeScale: 15.0, detailScale: 0.3, baseColor: [0.55, 0.55, 0.55], baseFreqScale: 0.04, detailFreqScale: 0.25 },
];

function pickBiome(t: number, m: number): BiomePrototype {
  let best = BIOMES[0];
  let bestD = Infinity;
  for (const b of BIOMES) {
    const dt = t - b.t;
    const dm = m - b.m;
    const d = dt * dt + dm * dm;
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function saturate(x: number): number { return Math.min(1, Math.max(0, x)); }

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
  
  // Multiple noise sources for terrain and biomes
  const noiseBase = createNoise2D(createSeededRng(seed + '_base'));
  const noiseDetail = createNoise2D(createSeededRng(seed + '_detail'));
  const noiseRidged = createNoise2D(createSeededRng(seed + '_ridged'));
  const noiseBillow = createNoise2D(createSeededRng(seed + '_billow'));
  const noiseTemp = createNoise2D(createSeededRng(seed + '_temp'));
  const noiseMoist = createNoise2D(createSeededRng(seed + '_moist'));
  const noiseVeg = createNoise2D(createSeededRng(seed + '_veg'));
  
  // Minecraft-inspired terrain control noise layers
  const noiseContinentalness = createNoise2D(createSeededRng(seed + '_continental'));
  const noiseErosion = createNoise2D(createSeededRng(seed + '_erosion'));
  const noisePeaksValleys = createNoise2D(createSeededRng(seed + '_peaks'));
  
  // Additional noise for scattered mountain peaks
  const noiseScatteredPeaks = createNoise2D(createSeededRng(seed + '_scattered'));
  const noisePeakHeight = createNoise2D(createSeededRng(seed + '_peak_height'));

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
  const colorGridR: number[][] = [];
  const colorGridG: number[][] = [];
  const colorGridB: number[][] = [];
  // Minecraft-inspired multi-scale noise system
  const BIOME_FREQ = 0.0004; // Larger biome regions but not massive (was 0.0006, then 0.0002)
  const CONTINENTALNESS_FREQ = 0.0001; // Very large scale terrain regions
  const EROSION_FREQ = 0.0008; // Controls mountain vs flat terrain
  const PEAKS_VALLEYS_FREQ = 0.004; // Fine-tunes mountain sharpness
  const SCATTERED_PEAKS_FREQ = 0.0015; // Frequency for rare scattered mountain peaks
  const PEAK_HEIGHT_FREQ = 0.003; // Frequency for peak height variation
  const WARP_STRENGTH = 60; // Increased domain warp for more interesting biome borders
  for (let z = 0; z < chunkSize; z++) {
    heightGrid[z] = [];
    colorGridR[z] = [];
    colorGridG[z] = [];
    colorGridB[z] = [];
    for (let x = 0; x < chunkSize; x++) {
      const worldX = worldOffsetX + x * worldScale;
      const worldZ = worldOffsetZ + z * worldScale;
      
      // Minecraft-inspired terrain control layers
      const continentalness = saturate(0.5 + 0.5 * noiseContinentalness(worldX * CONTINENTALNESS_FREQ, worldZ * CONTINENTALNESS_FREQ));
      const erosion = saturate(0.5 + 0.5 * noiseErosion(worldX * EROSION_FREQ, worldZ * EROSION_FREQ));
      const peaksValleys = saturate(0.5 + 0.5 * noisePeaksValleys(worldX * PEAKS_VALLEYS_FREQ, worldZ * PEAKS_VALLEYS_FREQ));

      // Domain warp inputs for biome masks
      const wx = worldX + WARP_STRENGTH * noiseBase(worldX * BIOME_FREQ * 0.7, worldZ * BIOME_FREQ * 0.7);
      const wz = worldZ + WARP_STRENGTH * noiseBase(worldX * BIOME_FREQ * 0.9 + 123.45, worldZ * BIOME_FREQ * 0.9 - 321.0);

      // Temperature and moisture in [0,1]
      let t = saturate(0.5 + 0.5 * noiseTemp(wx * BIOME_FREQ, wz * BIOME_FREQ));
      let m = saturate(0.5 + 0.5 * noiseMoist(wx * (BIOME_FREQ * 1.1) + 17.3, wz * (BIOME_FREQ * 1.1) - 42.7));

      // Altitude affects temperature (higher = colder)
      const elevationInfluence = Math.pow(continentalness, 1.5) * (1.0 - erosion);
      t = saturate(t - elevationInfluence * 0.4);

      const biome = pickBiome(t, m);

      // Calculate biome-specific frequencies
      const biomeBaseFreq = baseFrequency * biome.baseFreqScale;
      const biomeDetailFreq = detailFrequency * biome.detailFreqScale;

      // Multi-scale terrain synthesis
      // 1. Continental base height - controls overall elevation (much more extreme)
      const continentalHeight = continentalness * baseAmplitude * 3.0;
      
      // 2. Erosion controls mountainous vs flat terrain
      const erosionFactor = 1.0 - erosion; // Higher erosion = flatter
      
      // 3. Base terrain features using biome-specific frequencies
      const ridgedVal = 1 - Math.abs(noiseRidged(worldX * biomeBaseFreq, worldZ * biomeBaseFreq));
      const billowVal = Math.abs(noiseBillow(worldX * biomeBaseFreq, worldZ * biomeBaseFreq));
      const baseMix = lerp(billowVal, ridgedVal, biome.ridgedWeight);
      
      // 4. Scale terrain features by erosion and peaks/valleys
      const terrainScale = erosionFactor * (0.3 + 0.7 * peaksValleys);
      const baseHeight = continentalHeight + baseAmplitude * biome.amplitudeScale * terrainScale * (baseMix * 2 - 1);

      // 5. Detail layer using biome-specific detail frequency
      const detailVal = noiseDetail(worldX * biomeDetailFreq, worldZ * biomeDetailFreq);
      const detailHeight = detailAmplitude * biome.detailScale * erosionFactor * detailVal;

      // 6. Scattered mountain peaks - rare dramatic spikes
      const scatteredPeakVal = noiseScatteredPeaks(worldX * SCATTERED_PEAKS_FREQ, worldZ * SCATTERED_PEAKS_FREQ);
      const peakHeightVar = noisePeakHeight(worldX * PEAK_HEIGHT_FREQ, worldZ * PEAK_HEIGHT_FREQ);
      
      // Only create peaks where scattered noise is very high (rare)
      const peakThreshold = 0.75; // Higher = rarer peaks
      let scatteredPeakHeight = 0;
      if (scatteredPeakVal > peakThreshold) {
        // Strong exponential falloff to create sharp, dramatic peaks
        const peakStrength = Math.pow((scatteredPeakVal - peakThreshold) / (1.0 - peakThreshold), 2.0);
        // Very tall peaks with height variation
        const maxPeakHeight = baseAmplitude * (8.0 + 4.0 * Math.abs(peakHeightVar));
        scatteredPeakHeight = maxPeakHeight * peakStrength;
      }

      const height = baseHeight + detailHeight + scatteredPeakHeight;
      heightGrid[z][x] = height;

      // Biome-driven color with gentle height shading
      const shade = saturate(0.85 + 0.15 * (height / (baseAmplitude * 1.2)));
      colorGridR[z][x] = saturate(biome.baseColor[0] * shade);
      colorGridG[z][x] = saturate(biome.baseColor[1] * shade);
      colorGridB[z][x] = saturate(biome.baseColor[2] * shade);
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

  // Add vegetation using noise-based placement
  const vegetationBuilder = new GeometryBuilder();
  addVegetation(vegetationBuilder, heightGrid, chunkSize, worldScale, worldOffsetX, worldOffsetZ, noiseVeg);
  
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