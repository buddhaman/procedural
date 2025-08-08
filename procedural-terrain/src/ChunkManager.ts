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
    if (!this.currentTerrainParams) {
      return 0;
    }
    
    const { baseFrequency, baseAmplitude, detailFrequency, detailAmplitude, seed } = this.currentTerrainParams;
    
    // Get or create noise function for this seed (same as worker)
    let noise2D = this.noiseCache.get(seed);
    if (!noise2D) {
      // Use exact same RNG setup as worker
      const rng = this.createSeededRng(seed);
      noise2D = createNoise2D(rng);
      this.noiseCache.set(seed, noise2D);
    }
    
    // Use exact same calculation as worker
    const nx = worldX * baseFrequency;
    const nz = worldZ * baseFrequency;
    const dx = worldX * detailFrequency;
    const dz = worldZ * detailFrequency;
    
    const baseHeight = baseAmplitude * noise2D(nx, nz);
    const detailHeight = detailAmplitude * noise2D(dx, dz);
    
    return baseHeight + detailHeight;
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