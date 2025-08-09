import { BiomeParams } from './BiomeGenerator';
import { createNoise2D } from 'simplex-noise';

export interface TreeSpecies {
  name: string;
  baseColorRGB: [number, number, number];
  leafColorRGB: [number, number, number];
  sizeRange: [number, number]; // [min, max] height
  minSpacingR: number; // Poisson radius
  leafSize: number;
  useLeaves: boolean;
  suitability(T: number, M: number, h: number): number; // 0..1
}

export interface BiomeTreeProfile {
  biomeName: string;
  speciesWeights: Record<string, number>; // relative probabilities
  densityMax: number; // trees per area cap (0..1 scalar)
  riverBoost: number; // 0..1 -> 1.0..1.5
  slopeCutoff: [number, number]; // [θ0, θ1] fade out on steep slopes
  treeline(h: number, T: number): number; // 0/1 mask
}

export interface PlacedTree {
  x: number;
  y: number;
  z: number;
  species: string;
  size: number;
  tilt: number;
  color: [number, number, number];
  leafColor: [number, number, number];
  leafSize: number;
  useLeaves: boolean;
  priority: number;
  radius: number;
}

export class VegetationSystem {
  private treeSpecies: TreeSpecies[] = [];
  private biomeProfiles: BiomeTreeProfile[] = [];
  private seed: string;

  constructor(seed: string) {
    this.seed = seed;
    this.initializeSpecies();
    this.initializeBiomeProfiles();
  }

  private initializeSpecies() {
    this.treeSpecies = [
      {
        name: 'oak',
        baseColorRGB: [0.4, 0.2, 0.1], // Brown trunk
        leafColorRGB: [0.2, 0.6, 0.1],
        sizeRange: [4, 7], // Bigger oaks
        minSpacingR: 10,
        leafSize: 1.4,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = 1 - Math.abs(T - 0.6) * 2;
          const moistSuit = M;
          const altSuit = h < 50 ? 1 : Math.max(0, 1 - (h - 50) / 100);
          return Math.max(0, tempSuit * moistSuit * altSuit);
        }
      },
      {
        name: 'pine',
        baseColorRGB: [0.3, 0.15, 0.05], // Dark brown trunk
        leafColorRGB: [0.1, 0.4, 0.1],
        sizeRange: [6, 9], // Tall pines
        minSpacingR: 8,
        leafSize: 0.7,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = Math.max(0, 1 - (T - 0.3) * 2);
          const moistSuit = 0.5 + 0.5 * M;
          return tempSuit * moistSuit;
        }
      },
      {
        name: 'birch',
        baseColorRGB: [0.9, 0.9, 0.8], // White/silver trunk
        leafColorRGB: [0.3, 0.7, 0.2],
        sizeRange: [3, 5],
        minSpacingR: 6,
        leafSize: 0.9,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = 1 - Math.abs(T - 0.4) * 1.5;
          const moistSuit = M * M;
          return Math.max(0, tempSuit * moistSuit);
        }
      },
      {
        name: 'cactus',
        baseColorRGB: [0.2, 0.5, 0.2], // Green trunk (cactus body)
        leafColorRGB: [0.4, 0.6, 0.2],
        sizeRange: [2, 4],
        minSpacingR: 12,
        leafSize: 0.3,
        useLeaves: false,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = Math.max(0, (T - 0.7) * 3);
          const moistSuit = Math.max(0, 1 - M * 2);
          return tempSuit * moistSuit;
        }
      },
      {
        name: 'spruce',
        baseColorRGB: [0.25, 0.12, 0.04], // Dark brown trunk
        leafColorRGB: [0.05, 0.3, 0.05],
        sizeRange: [5, 8], // Tall spruces
        minSpacingR: 9,
        leafSize: 0.6,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = Math.max(0, 1 - T * 2);
          const moistSuit = 0.3 + 0.7 * M;
          const altSuit = h > 30 ? 1 : h / 30;
          return tempSuit * moistSuit * altSuit;
        }
      },
      {
        name: 'palm',
        baseColorRGB: [0.5, 0.35, 0.2], // Tan trunk
        leafColorRGB: [0.2, 0.8, 0.1],
        sizeRange: [4, 6],
        minSpacingR: 10,
        leafSize: 1.8,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          const tempSuit = Math.max(0, (T - 0.6) * 2);
          const moistSuit = M * M * M;
          const altSuit = h < 20 ? 1 : Math.max(0, 1 - (h - 20) / 30);
          return tempSuit * moistSuit * altSuit;
        }
      },
      {
        name: 'redwood',
        baseColorRGB: [0.6, 0.3, 0.2], // Reddish trunk
        leafColorRGB: [0.1, 0.5, 0.1],
        sizeRange: [8, 12], // MASSIVE trees
        minSpacingR: 15,
        leafSize: 2.0,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          // Likes moderate temp, very high moisture, coastal areas
          const tempSuit = 1 - Math.abs(T - 0.5) * 1.5;
          const moistSuit = M * M * M; // needs very wet conditions
          return Math.max(0, tempSuit * moistSuit);
        }
      },
      {
        name: 'willow',
        baseColorRGB: [0.45, 0.35, 0.25], // Gray-brown trunk
        leafColorRGB: [0.3, 0.8, 0.2], // Bright green drooping leaves
        sizeRange: [4, 6],
        minSpacingR: 12,
        leafSize: 1.6,
        useLeaves: true,
        suitability: (T: number, M: number, h: number) => {
          // Likes moderate temp, very wet (near water)
          const tempSuit = 1 - Math.abs(T - 0.6) * 1.2;
          const moistSuit = M * M * M; // loves water
          return Math.max(0, tempSuit * moistSuit);
        }
      }
    ];
  }

  private initializeBiomeProfiles() {
    this.biomeProfiles = [
      {
        biomeName: 'ocean',
        speciesWeights: {},
        densityMax: 0,
        riverBoost: 0,
        slopeCutoff: [30, 45],
        treeline: () => 0
      },
      {
        biomeName: 'plains',
        speciesWeights: {
          'oak': 0.5,
          'birch': 0.2,
          'pine': 0.1,
          'willow': 0.2 // Willows near rivers in plains
        },
        densityMax: 0.15,
        riverBoost: 0.8,
        slopeCutoff: [25, 40],
        treeline: (h: number, T: number) => h < 100 ? 1 : 0
      },
      {
        biomeName: 'forest',
        speciesWeights: {
          'oak': 0.3,
          'birch': 0.2,
          'pine': 0.2,
          'redwood': 0.15, // Massive trees in forests
          'willow': 0.1,
          'palm': 0.05
        },
        densityMax: 0.8,
        riverBoost: 1.0,
        slopeCutoff: [30, 50],
        treeline: (h: number, T: number) => h < 120 ? 1 : 0
      },
      {
        biomeName: 'desert',
        speciesWeights: {
          'cactus': 1.0
        },
        densityMax: 0.02,
        riverBoost: 0.5,
        slopeCutoff: [20, 35],
        treeline: (h: number, T: number) => h < 80 ? 1 : 0
      },
      {
        biomeName: 'mountains',
        speciesWeights: {
          'pine': 0.4,
          'spruce': 0.4,
          'birch': 0.2
        },
        densityMax: 0.3,
        riverBoost: 0.6,
        slopeCutoff: [35, 55],
        treeline: (h: number, T: number) => {
          const treeline = 150 - T * 50; // Colder = higher treeline
          return h < treeline ? 1 : 0;
        }
      },
      {
        biomeName: 'tundra',
        speciesWeights: {
          'spruce': 0.7,
          'birch': 0.3
        },
        densityMax: 0.05,
        riverBoost: 0.3,
        slopeCutoff: [20, 40],
        treeline: (h: number, T: number) => h < 60 ? 1 : 0
      }
    ];
  }

  // Hash functions for deterministic placement
  private hash64(seed: string, x: number, y: number, i: number): number {
    let h = 1779033703 ^ seed.length;
    
    // Mix in coordinates and index
    h = Math.imul(h ^ x, 3432918353);
    h = Math.imul(h ^ y, 1911520717);
    h = Math.imul(h ^ i, 2654435761);
    
    // Additional mixing
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  private H01(hash: number): number {
    return (hash >>> 0) / 4294967296;
  }

  // Multi-scale noise for vegetation intensity
  private noiseL1: any;
  private noiseL2: any;  
  private noiseL3: any;

  private initializeVegNoise() {
    if (!this.noiseL1) {
      const rng1 = this.createSeededRng(this.seed + '_vegL1');
      const rng2 = this.createSeededRng(this.seed + '_vegL2');
      const rng3 = this.createSeededRng(this.seed + '_vegL3');
      
      this.noiseL1 = createNoise2D(rng1);
      this.noiseL2 = createNoise2D(rng2);
      this.noiseL3 = createNoise2D(rng3);
    }
  }

  private createSeededRng(seed: string) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    const seedFn = () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
    
    let a = seedFn();
    return () => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private remap(value: number): number {
    return Math.max(0, Math.min(1, 0.5 + 0.5 * value));
  }

  private smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  // Compute vegetation intensity λ(x,y) - BIOME BASED BUT SIMPLIFIED
  public computeVegetationIntensity(
    x: number, 
    y: number, 
    biomeParams: BiomeParams,
    weights: number[]
  ): number {
    // Blend biome profiles by RBF weights
    let densityMax = 0;

    for (let i = 0; i < this.biomeProfiles.length; i++) {
      const weight = weights[i] || 0;
      const profile = this.biomeProfiles[i];
      densityMax += profile.densityMax * weight;
    }

    // Boost density to make sure we see trees
    const boostedDensity = Math.min(1, densityMax * 2);
    
    // Add some variation but keep it reasonable
    const variation = 0.8 + 0.4 * Math.sin(x * 0.001) * Math.cos(y * 0.001);
    
    return Math.max(0, boostedDensity * variation);
  }

  // Priority Poisson placement
  public placeTrees(
    chunkX: number,
    chunkZ: number,
    chunkSize: number,
    worldScale: number,
    getBiomeParams: (x: number, y: number) => { params: BiomeParams, weights: number[] }
  ): PlacedTree[] {
    const trees: PlacedTree[] = [];
    const cellSize = 16; // Grid cell size for Poisson sampling
    const K = 2; // Candidates per cell

    const startX = chunkX * chunkSize * worldScale;
    const startZ = chunkZ * chunkSize * worldScale;
    const endX = startX + chunkSize * worldScale;
    const endZ = startZ + chunkSize * worldScale;

    // Grid-based sampling
    for (let cellX = Math.floor(startX / cellSize); cellX * cellSize < endX; cellX++) {
      for (let cellZ = Math.floor(startZ / cellSize); cellZ * cellSize < endZ; cellZ++) {
        
        for (let i = 0; i < K; i++) {
          const h = this.hash64(this.seed, cellX, cellZ, i);
          const u = this.H01(h << 17);
          const v = this.H01(h << 29);
          
          // Jitter within cell
          const px = cellX * cellSize + u * cellSize;
          const py = cellZ * cellSize + v * cellSize;

          // Skip if outside chunk bounds
          if (px < startX || px >= endX || py < startZ || py >= endZ) continue;

          const { params, weights } = getBiomeParams(px, py);
          const lambda = this.computeVegetationIntensity(px, py, params, weights);

          // Inhomogeneous thinning
          if (this.H01(h << 7) >= lambda) continue;

          // Select species
          const species = this.selectSpecies(params, weights, h << 23);
          if (!species) continue;

          const treeData = this.treeSpecies.find(s => s.name === species)!;
          const priority = h;
          const radius = treeData.minSpacingR;

          // Poisson disk check
          let tooClose = false;
          for (const existing of trees) {
            const dist = Math.sqrt((px - existing.x) ** 2 + (py - existing.z) ** 2);
            if (dist < Math.max(radius, existing.radius)) {
              if (existing.priority > priority) {
                tooClose = true;
                break;
              } else {
                // Remove the existing tree (lower priority)
                const index = trees.indexOf(existing);
                trees.splice(index, 1);
                break;
              }
            }
          }

          if (tooClose) continue;

          // Generate tree variation
          const size = treeData.sizeRange[0] + (treeData.sizeRange[1] - treeData.sizeRange[0]) * this.H01(h << 11);
          const tilt = (this.H01(h << 19) - 0.5) * 0.2; // Max 0.1 radian tilt
          const hueJitter = (this.H01(h << 31) - 0.5) * 0.1;
          
          // Biome-based color modulation
          const { temperature: T, moisture: M, finalHeight: altitude } = params;
          
          // Temperature affects leaf colors: cold = more blue/cyan, hot = more yellow/red
          const tempMod = (T - 0.5) * 0.3; // -0.15 to +0.15
          // Moisture affects green intensity: wet = more green, dry = less green
          const moistMod = (M - 0.5) * 0.2; // -0.1 to +0.1
          // Altitude affects colors: high = more blue/purple, low = more green/yellow
          const altMod = Math.min(0.2, altitude / 200) * 0.3; // 0 to 0.3
          
          // Apply climate modulation to trunk colors
          const color: [number, number, number] = [
            Math.max(0, Math.min(1, treeData.baseColorRGB[0] + hueJitter + tempMod * 0.5)),
            Math.max(0, Math.min(1, treeData.baseColorRGB[1] + hueJitter)),
            Math.max(0, Math.min(1, treeData.baseColorRGB[2] + hueJitter - tempMod * 0.3))
          ];
          
          // Apply stronger climate modulation to leaf colors for more dramatic variation
          const leafColor: [number, number, number] = [
            Math.max(0, Math.min(1, treeData.leafColorRGB[0] + hueJitter + tempMod - moistMod + altMod)),
            Math.max(0, Math.min(1, treeData.leafColorRGB[1] + hueJitter + moistMod - altMod * 0.5)),
            Math.max(0, Math.min(1, treeData.leafColorRGB[2] + hueJitter - tempMod + altMod))
          ];

          trees.push({
            x: px,
            y: params.finalHeight, // Ground height
            z: py,
            species,
            size,
            tilt,
            color,
            leafColor,
            leafSize: treeData.leafSize,
            useLeaves: treeData.useLeaves,
            priority,
            radius
          });
        }
      }
    }

    return trees;
  }

  private selectSpecies(params: BiomeParams, weights: number[], hash: number): string | null {
    const { temperature: T, moisture: M, finalHeight: h } = params;
    
    // Calculate species probabilities
    const speciesProbs: Record<string, number> = {};
    
    for (const species of this.treeSpecies) {
      let baseWeight = 0;
      
      // Blend biome species weights
      for (let i = 0; i < this.biomeProfiles.length; i++) {
        const weight = weights[i] || 0;
        const profile = this.biomeProfiles[i];
        baseWeight += (profile.speciesWeights[species.name] || 0) * weight;
      }
      
      // Apply suitability
      const suitability = species.suitability(T, M, h);
      speciesProbs[species.name] = baseWeight * suitability;
    }

    // Normalize and select
    const total = Object.values(speciesProbs).reduce((sum, prob) => sum + prob, 0);
    if (total <= 0) return 'oak'; // fallback

    const rand = this.H01(hash);
    let cumulative = 0;
    
    for (const [speciesName, prob] of Object.entries(speciesProbs)) {
      cumulative += prob / total;
      if (rand <= cumulative) {
        return speciesName;
      }
    }

    return 'oak'; // fallback
  }
}