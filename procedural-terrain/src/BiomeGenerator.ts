import { createNoise2D } from 'simplex-noise';

export interface BiomeParams {
  continentalness: number;  // C: 0=coast, 1=inland
  erosion: number;         // E: 0=flat, 1=jagged
  temperature: number;     // T: 0=cold, 1=hot
  moisture: number;        // M: 0=dry, 1=wet
  mountainMask: number;    // Mmask: 0=flat, 1=mountain
  relief: number;          // R: ridged noise
  detail: number;          // D: fractal detail
  warpedX: number;         // Domain warped X
  warpedY: number;         // Domain warped Y
  baseHeight: number;      // Base height before relief
  finalHeight: number;     // Final height after all processing
}

export interface BiomeSettings {
  name: string;
  targetT: number;
  targetM: number;
  targetMmask: number;
  mountainScale: number;
  detailScale: number;
  seaLevel: number;
  inlandPlateau: number;
  materials: {
    surface: [number, number, number];
    deep: [number, number, number];
    rock: [number, number, number];
  };
}

export class BiomeGenerator {
  // Noise functions for control fields
  private noiseC: any;  // Continentalness
  private noiseE: any;  // Erosion
  private noiseT: any;  // Temperature
  private noiseM: any;  // Moisture
  private noiseU: any;  // Domain warp U
  private noiseV: any;  // Domain warp V
  private noiseR: any;  // Relief (ridged)
  private noiseD: any;  // Detail (fBM base)
  private noiseMountainRange: any; // Continental-scale mountain ranges

  // Biome definitions in climate space (T, M) only - mountainness is separate
  private biomes: BiomeSettings[] = [
    {
      name: 'ocean',
      targetT: 0.5, targetM: 0.9, targetMmask: 0.0, // targetMmask not used anymore
      mountainScale: 0, detailScale: 2, seaLevel: -5, inlandPlateau: 5,
      materials: { surface: [0.1, 0.3, 0.8], deep: [0.05, 0.2, 0.6], rock: [0.2, 0.2, 0.5] }
    },
    {
      name: 'plains',
      targetT: 0.7, targetM: 0.3, targetMmask: 0.0,
      mountainScale: 80, detailScale: 10, seaLevel: 0, inlandPlateau: 20,
      materials: { surface: [0.2, 0.8, 0.2], deep: [0.1, 0.6, 0.1], rock: [0.3, 0.7, 0.3] }
    },
    {
      name: 'forest',
      targetT: 0.4, targetM: 0.8, targetMmask: 0.0,
      mountainScale: 100, detailScale: 15, seaLevel: 0, inlandPlateau: 25,
      materials: { surface: [0.1, 0.6, 0.1], deep: [0.05, 0.4, 0.05], rock: [0.2, 0.5, 0.2] }
    },
    {
      name: 'desert',
      targetT: 0.9, targetM: 0.1, targetMmask: 0.0,
      mountainScale: 90, detailScale: 20, seaLevel: 0, inlandPlateau: 15,
      materials: { surface: [0.9, 0.8, 0.3], deep: [0.8, 0.6, 0.2], rock: [0.7, 0.5, 0.1] }
    },
    {
      name: 'mountains',
      targetT: 0.2, targetM: 0.6, targetMmask: 0.0,
      mountainScale: 150, detailScale: 25, seaLevel: 0, inlandPlateau: 40,
      materials: { surface: [0.6, 0.6, 0.6], deep: [0.5, 0.5, 0.5], rock: [0.7, 0.7, 0.7] }
    },
    {
      name: 'tundra',
      targetT: 0.1, targetM: 0.2, targetMmask: 0.0,
      mountainScale: 70, detailScale: 12, seaLevel: 0, inlandPlateau: 10,
      materials: { surface: [0.8, 0.9, 1.0], deep: [0.7, 0.8, 0.9], rock: [0.6, 0.7, 0.8] }
    }
  ];

  constructor(seed: string) {
    this.initializeNoiseFunctions(seed);
  }

  private initializeNoiseFunctions(seed: string) {
    // Control fields with different frequencies
    this.noiseC = createNoise2D(this.createSeededRng(seed + '_continental'));
    this.noiseE = createNoise2D(this.createSeededRng(seed + '_erosion'));
    this.noiseT = createNoise2D(this.createSeededRng(seed + '_temperature'));
    this.noiseM = createNoise2D(this.createSeededRng(seed + '_moisture'));
    
    // Domain warp
    this.noiseU = createNoise2D(this.createSeededRng(seed + '_warp_u'));
    this.noiseV = createNoise2D(this.createSeededRng(seed + '_warp_v'));
    
    // Relief and detail
    this.noiseR = createNoise2D(this.createSeededRng(seed + '_relief'));
    this.noiseD = createNoise2D(this.createSeededRng(seed + '_detail'));
    
    // Continental-scale mountain ranges
    this.noiseMountainRange = createNoise2D(this.createSeededRng(seed + '_mountain_range'));
  }

  private xmur3(str: string) {
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

  private mulberry32(a: number) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private createSeededRng(seed: string) {
    const seedFn = this.xmur3(seed);
    const rng = this.mulberry32(seedFn());
    return rng;
  }

  private remap(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  private ridgedNoise(x: number, y: number, frequency: number): number {
    const n = this.noiseR(x * frequency, y * frequency);
    return 1 - Math.abs(n);
  }

  private fBM(x: number, y: number, baseFreq: number, octaves: number): number {
    let result = 0;
    let amplitude = 1;
    let frequency = baseFreq;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      result += this.noiseD(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return result / maxValue;
  }

  private riverCarve(x: number, y: number, C: number, E: number): number {
    // Simple river carving - can be expanded
    const riverNoise = this.noiseE(x * 0.0001, y * 0.0001);
    const riverMask = Math.max(0, 1 - Math.abs(riverNoise) * 10);
    const riverDepth = riverMask * riverMask * C * 8;
    return riverDepth;
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private rbfSoftmax(T: number, W: number, sigma: number = 0.2): number[] {
    // RBF (Radial Basis Function) weights in climate space
    const weights = this.biomes.map(biome => {
      const dT = T - biome.targetT;
      const dW = W - biome.targetM; // targetM is moisture
      const distanceSquared = dT * dT + dW * dW;
      return Math.exp(-distanceSquared / (2 * sigma * sigma));
    });
    
    // Normalize weights to sum to 1
    const sum = weights.reduce((a, b) => a + b, 0);
    return sum > 0 ? weights.map(w => w / sum) : weights;
  }

  private computeGradientBasedSigma(T: number, W: number, x: number, y: number): number {
    // Sample nearby points to estimate gradient
    const delta = 100; // world units
    const T1 = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseT((x + delta) / 5000, y / 5000)));
    const T2 = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseT((x - delta) / 5000, y / 5000)));
    const W1 = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseM(x / 5000, (y + delta) / 5000)));
    const W2 = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseM(x / 5000, (y - delta) / 5000)));
    
    const gradT = Math.abs(T1 - T2) / (2 * delta);
    const gradW = Math.abs(W1 - W2) / (2 * delta);
    const gradMagnitude = gradT + gradW;
    
    // Adaptive sigma: constant world-space edge width
    const k = 0.02; // tuning parameter
    const epsilon = 0.0001;
    const sigmaLocal = Math.max(0.1, Math.min(0.4, k / (gradMagnitude + epsilon)));
    
    return sigmaLocal;
  }

  public generateBiomeParams(x: number, y: number): BiomeParams {
    // 1. Control fields with MUCH larger scales for bigger biome regions
    const C = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseC(x / 8000, y / 8000)));
    const E = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseE(x / 3000, y / 3000)));
    const T = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseT(x / 5000, y / 5000)));
    const M = Math.max(0, Math.min(1, 0.5 + 0.5 * this.noiseM(x / 5000, y / 5000)));

    // 2. Domain warp with larger scale for bigger warped regions
    const u = this.noiseU(x / 2000, y / 2000) * 120;
    const v = this.noiseV((x + 77) / 2000, (y - 13) / 2000) * 120;
    const xw = x + u;
    const yw = y + v;

    // 3. Relief & detail
    const R = this.ridgedNoise(xw, yw, 1 / 900);
    const D = this.fBM(xw, yw, 1 / 300, 4);

    // 4. Continental-scale mountain ranges - SIMPLE and POWERFUL
    // Very large scale noise for continent-wide mountain ranges
    const mountainRangeNoise = this.noiseMountainRange(xw / 15000, yw / 15000);
    
    // Sharp mountain ranges with smooth falloff
    const Z = this.smoothstep(0.1, 0.6, Math.abs(mountainRangeNoise));
    
    // Add some variation within mountain ranges
    const mountainVariation = this.noiseE(xw / 4000, yw / 4000);
    const finalZ = Math.max(0, Z + mountainVariation * 0.2);

    // 6. Smooth biome blending using RBF in climate space (T, M only)
    // Mountainness (finalZ) is separate and handled independently
    
    // Adaptive sigma based on gradient for consistent transition width
    const sigma = this.computeGradientBasedSigma(T, M, x, y);
    const weights = this.rbfSoftmax(T, M, sigma);
    
    // Blend biome parameters (not including mountainness)
    let mountainScale = 0;
    let detailScale = 0;
    let seaLevel = 0;
    let inlandPlateau = 0;
    let surfaceR = 0, surfaceG = 0, surfaceB = 0;

    for (let i = 0; i < this.biomes.length; i++) {
      const biome = this.biomes[i];
      const weight = weights[i];
      
      mountainScale += biome.mountainScale * weight;
      detailScale += biome.detailScale * weight;
      seaLevel += biome.seaLevel * weight;
      inlandPlateau += biome.inlandPlateau * weight;
      
      surfaceR += biome.materials.surface[0] * weight;
      surfaceG += biome.materials.surface[1] * weight;
      surfaceB += biome.materials.surface[2] * weight;
    }

    // 5. Height calculation using mountainness finalZ and blended biome parameters
    const base = this.lerp(seaLevel, inlandPlateau, C); // Use C directly for base height
    const relief = Math.pow(R, 1.8) * finalZ; // finalZ controls WHERE mountains appear
    let h = base + relief * mountainScale + D * detailScale; // blended params control HOW MUCH
    h -= this.riverCarve(x, y, C, E);

    return {
      continentalness: C,
      erosion: E,
      temperature: T,
      moisture: M,
      mountainMask: finalZ, // Use the new mountain range field
      relief: R,
      detail: D,
      warpedX: xw,
      warpedY: yw,
      baseHeight: base,
      finalHeight: h
    };
  }

  public getBiomeName(params: BiomeParams): string {
    const { temperature: T, moisture: M } = params;
    
    // Use the same RBF blending but return the dominant biome name
    const weights = this.rbfSoftmax(T, M, 0.2);
    
    let maxWeight = 0;
    let dominantBiome = this.biomes[0];
    
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] > maxWeight) {
        maxWeight = weights[i];
        dominantBiome = this.biomes[i];
      }
    }

    return dominantBiome.name;
  }

  public getSurfaceColor(params: BiomeParams): [number, number, number] {
    const { temperature: T, moisture: M } = params;
    
    // Use the same RBF blending for smooth color transitions
    const weights = this.rbfSoftmax(T, M, 0.2);
    
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < this.biomes.length; i++) {
      const color = this.biomes[i].materials.surface;
      const weight = weights[i];
      r += color[0] * weight;
      g += color[1] * weight;
      b += color[2] * weight;
    }
    
    return [r, g, b];
  }

  public getAllParams(): BiomeParams {
    // For debugging - return the last generated params
    return this.generateBiomeParams(0, 0);
  }
}