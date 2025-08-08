import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { ChunkParams, WorkerResult, ChunkCoord, CHUNK_SIZE, CHUNK_WORLD_SIZE, RENDER_DISTANCE, WATER_LEVEL } from './types';
import { createWaterMaterial } from './WaterShader';

export class TerrainChunk {
  public readonly coord: ChunkCoord;
  public readonly worldX: number;
  public readonly worldZ: number;
  public terrainMesh?: THREE.Mesh;
  public isLoading = false;
  public isLoaded = false;
  public heights?: Float32Array;

  constructor(coord: ChunkCoord) {
    this.coord = coord;
    this.worldX = coord.x * CHUNK_WORLD_SIZE;
    this.worldZ = coord.z * CHUNK_WORLD_SIZE;
  }

  dispose() {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.parent?.remove(this.terrainMesh);
    }
    this.terrainMesh = undefined;
    this.isLoaded = false;
  }
}

export class ChunkManager {
  private chunks = new Map<string, TerrainChunk>();
  private workerPool: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private workQueue: { chunk: TerrainChunk; params: ChunkParams }[] = [];
  private scene: THREE.Scene;
  private terrainMaterial: THREE.Material;
  private waterPlane?: THREE.Mesh;
  public waterMaterial: THREE.ShaderMaterial;
  private currentTerrainParams: any;
  private noiseCache = new Map<string, any>();

  constructor(scene: THREE.Scene, workerCount = 4) {
    this.scene = scene;
    this.terrainMaterial = this.createTerrainMaterial();
    this.waterMaterial = createWaterMaterial(WATER_LEVEL);
    this.initWorkerPool(workerCount);
    this.createWaterPlane();
  }

  private createTerrainMaterial(): THREE.Material {
    return new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: true,
    });
  }

  private createWaterPlane() {
    const waterSize = 2000; // Large plane that covers visible area
    const waterGeometry = new THREE.PlaneGeometry(waterSize, waterSize, 64, 64);
    waterGeometry.rotateX(-Math.PI / 2); // Rotate to be horizontal
    
    this.waterPlane = new THREE.Mesh(waterGeometry, this.waterMaterial);
    this.waterPlane.position.y = WATER_LEVEL;
    this.waterPlane.renderOrder = 1; // Render after terrain
    this.scene.add(this.waterPlane);
  }

  private initWorkerPool(count: number) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => this.onWorkerMessage(worker, event);
      this.workerPool.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  private onWorkerMessage(worker: Worker, event: MessageEvent<WorkerResult>) {
    const result = event.data;
    const chunkKey = `${result.chunkX},${result.chunkZ}`;
    const chunk = this.chunks.get(chunkKey);

    if (chunk && chunk.isLoading) {
      this.processChunkResult(chunk, result);
      chunk.isLoading = false;
      chunk.isLoaded = true;
    }

    // Return worker to pool and process next job
    this.availableWorkers.push(worker);
    this.processWorkQueue();
  }

  private processChunkResult(chunk: TerrainChunk, result: WorkerResult) {
    // Create terrain geometry
    const terrainGeometry = new THREE.BufferGeometry();
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
    terrainGeometry.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
    
    if (result.colors) {
      terrainGeometry.setAttribute('color', new THREE.BufferAttribute(result.colors, 3));
    }
    
    // For flat shading, we don't use indices - vertices are already in triangle order
    if (result.indices.length > 0) {
      terrainGeometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
    }
    
    terrainGeometry.computeBoundingSphere();

    // Create terrain mesh
    if (chunk.terrainMesh) {
      chunk.terrainMesh.geometry.dispose();
      chunk.terrainMesh.geometry = terrainGeometry;
    } else {
      chunk.terrainMesh = new THREE.Mesh(terrainGeometry, this.terrainMaterial);
      chunk.terrainMesh.position.set(chunk.worldX, 0, chunk.worldZ);
      chunk.terrainMesh.castShadow = false;
      chunk.terrainMesh.receiveShadow = true;
      this.scene.add(chunk.terrainMesh);
    }

    // Authoritative heightfield for collision
    if (result.heights) {
      chunk.heights = result.heights;
    }
  }

  public updateWater(time: number, cameraPosition: THREE.Vector3, terrainParams?: any) {
    if (this.waterPlane) {
      // Update water plane position to follow camera (infinite water effect)
      this.waterPlane.position.x = cameraPosition.x;
      this.waterPlane.position.z = cameraPosition.z;
      
      // Update shader uniforms
      this.waterMaterial.uniforms.time.value = time;
      
      // Update terrain parameters if provided (for accurate height calculation)
      if (terrainParams) {
        this.waterMaterial.uniforms.baseFrequency.value = terrainParams.baseFrequency;
        this.waterMaterial.uniforms.baseAmplitude.value = terrainParams.baseAmplitude;
        this.waterMaterial.uniforms.detailFrequency.value = terrainParams.detailFrequency;
        this.waterMaterial.uniforms.detailAmplitude.value = terrainParams.detailAmplitude;
      }
    }
  }

  private processWorkQueue() {
    while (this.workQueue.length > 0 && this.availableWorkers.length > 0) {
      const job = this.workQueue.shift()!;
      const worker = this.availableWorkers.pop()!;
      
      job.chunk.isLoading = true;
      worker.postMessage(job.params);
    }
  }

  public updateChunks(playerPosition: THREE.Vector3, terrainParams: Omit<ChunkParams, 'chunkX' | 'chunkZ' | 'worldOffsetX' | 'worldOffsetZ'>) {
    // Store current terrain parameters for height sampling
    this.currentTerrainParams = terrainParams;
    
    const playerChunkX = Math.floor(playerPosition.x / CHUNK_WORLD_SIZE);
    const playerChunkZ = Math.floor(playerPosition.z / CHUNK_WORLD_SIZE);

    const neededChunks = new Set<string>();
    
    // Determine which chunks are needed
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        const key = `${chunkX},${chunkZ}`;
        neededChunks.add(key);

        if (!this.chunks.has(key)) {
          const chunk = new TerrainChunk({ x: chunkX, z: chunkZ });
          this.chunks.set(key, chunk);
          
          const chunkParams: ChunkParams = {
            ...terrainParams,
            chunkX,
            chunkZ,
            worldOffsetX: chunk.worldX,
            worldOffsetZ: chunk.worldZ,
          };

          this.workQueue.push({ chunk, params: chunkParams });
        }
      }
    }

    // Remove chunks that are too far away
    for (const [key, chunk] of this.chunks.entries()) {
      if (!neededChunks.has(key)) {
        chunk.dispose();
        this.chunks.delete(key);
      }
    }

    this.processWorkQueue();
  }

  public getHeightAt(worldX: number, worldZ: number): number {
    // Sample authoritative heights from the owning chunk (bilinear)
    const chunkX = Math.floor(worldX / CHUNK_WORLD_SIZE);
    const chunkZ = Math.floor(worldZ / CHUNK_WORLD_SIZE);
    const key = `${chunkX},${chunkZ}`;
    const chunk = this.chunks.get(key);
    if (!chunk || !chunk.heights) return -Infinity;

    const localX = worldX - chunk.worldX;
    const localZ = worldZ - chunk.worldZ;
    const scale = CHUNK_WORLD_SIZE / (CHUNK_SIZE - 1);
    const gx = localX / scale;
    const gz = localZ / scale;

    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    if (x0 < 0 || x0 >= CHUNK_SIZE - 1 || z0 < 0 || z0 >= CHUNK_SIZE - 1) return -Infinity;

    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = gx - x0;
    const tz = gz - z0;

    const i00 = z0 * CHUNK_SIZE + x0;
    const i10 = z0 * CHUNK_SIZE + x1;
    const i01 = z1 * CHUNK_SIZE + x0;
    const i11 = z1 * CHUNK_SIZE + x1;

    const h00 = chunk.heights[i00];
    const h10 = chunk.heights[i10];
    const h01 = chunk.heights[i01];
    const h11 = chunk.heights[i11];

    const y0 = h00 * (1 - tx) + h10 * tx;
    const y1 = h01 * (1 - tx) + h11 * tx;
    return y0 * (1 - tz) + y1 * tz;
  }

  // Exact same RNG functions as worker
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

  public getBiomeAt(worldX: number, worldZ: number, terrainParams?: any): string {
    if (!terrainParams) {
      return 'Unknown';
    }
    
    // Replicate the biome detection logic from the worker
    const BIOME_FREQ = 0.0004;
    const WARP_STRENGTH = 60;
    
    // Get or create noise functions for biome detection
    const seed = terrainParams.seed || 'terrain-42';
    let noiseBase = this.noiseCache.get(seed + '_base');
    let noiseTemp = this.noiseCache.get(seed + '_temp');  
    let noiseMoist = this.noiseCache.get(seed + '_moist');
    
    if (!noiseBase) {
      const rng = this.createSeededRng(seed + '_base');
      noiseBase = createNoise2D(rng);
      this.noiseCache.set(seed + '_base', noiseBase);
    }
    
    if (!noiseTemp) {
      const rng = this.createSeededRng(seed + '_temp');
      noiseTemp = createNoise2D(rng);
      this.noiseCache.set(seed + '_temp', noiseTemp);
    }
    
    if (!noiseMoist) {
      const rng = this.createSeededRng(seed + '_moist');
      noiseMoist = createNoise2D(rng);
      this.noiseCache.set(seed + '_moist', noiseMoist);
    }
    
    // Domain warp for biome masks
    const wx = worldX + WARP_STRENGTH * noiseBase(worldX * BIOME_FREQ * 0.7, worldZ * BIOME_FREQ * 0.7);
    const wz = worldZ + WARP_STRENGTH * noiseBase(worldX * BIOME_FREQ * 0.9 + 123.45, worldZ * BIOME_FREQ * 0.9 - 321.0);

    // Temperature and moisture
    const t = Math.max(0, Math.min(1, 0.5 + 0.5 * noiseTemp(wx * BIOME_FREQ, wz * BIOME_FREQ)));
    const m = Math.max(0, Math.min(1, 0.5 + 0.5 * noiseMoist(wx * (BIOME_FREQ * 1.1) + 17.3, wz * (BIOME_FREQ * 1.1) - 42.7)));

    // Biome selection (replicated from worker)
    const biomes = [
      { name: 'desert',   t: 0.9, m: 0.1 },
      { name: 'savanna',  t: 0.8, m: 0.3 },
      { name: 'grass',    t: 0.7, m: 0.5 },
      { name: 'forest',   t: 0.6, m: 0.75 },
      { name: 'rain',     t: 0.85, m: 0.9 },
      { name: 'taiga',    t: 0.35, m: 0.55 },
      { name: 'tundra',   t: 0.2, m: 0.3 },
      { name: 'alpine',   t: 0.1, m: 0.4 },
    ];
    
    let best = biomes[0];
    let bestDistance = Infinity;
    
    for (const biome of biomes) {
      const dt = t - biome.t;
      const dm = m - biome.m;
      const distance = dt * dt + dm * dm;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = biome;
      }
    }
    
    return best.name;
  }

  public dispose() {
    for (const chunk of this.chunks.values()) {
      chunk.dispose();
    }
    this.chunks.clear();
    
    if (this.waterPlane) {
      this.waterPlane.geometry.dispose();
      this.waterPlane.parent?.remove(this.waterPlane);
      this.waterPlane = undefined;
    }
    
    this.waterMaterial.dispose();
    
    for (const worker of this.workerPool) {
      worker.terminate();
    }
    this.workerPool.length = 0;
    this.availableWorkers.length = 0;
  }
}