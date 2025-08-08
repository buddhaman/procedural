import * as THREE from 'three';
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
    });
  }

  private createWaterPlane() {
    const waterSize = 2000; // Large plane that covers visible area
    const waterGeometry = new THREE.PlaneGeometry(waterSize, waterSize, 128, 128);
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
    
    terrainGeometry.setIndex(new THREE.BufferAttribute(result.indices, 1));
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

  public updateWater(time: number, cameraPosition: THREE.Vector3) {
    if (this.waterPlane) {
      // Update water plane position to follow camera (infinite water effect)
      this.waterPlane.position.x = cameraPosition.x;
      this.waterPlane.position.z = cameraPosition.z;
      
      // Update shader uniforms
      this.waterMaterial.uniforms.time.value = time;
      this.waterMaterial.uniforms.cameraPosition.value.copy(cameraPosition);
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
    const chunkX = Math.floor(worldX / CHUNK_WORLD_SIZE);
    const chunkZ = Math.floor(worldZ / CHUNK_WORLD_SIZE);
    const chunkKey = `${chunkX},${chunkZ}`;
    const chunk = this.chunks.get(chunkKey);

    if (!chunk?.terrainMesh?.geometry) return -Infinity;

    const geometry = chunk.terrainMesh.geometry;
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    
    // Convert world coordinates to local chunk coordinates
    const localX = worldX - chunk.worldX;
    const localZ = worldZ - chunk.worldZ;
    
    // Convert to grid coordinates
    const scale = CHUNK_WORLD_SIZE / (CHUNK_SIZE - 1);
    const gx = localX / scale;
    const gz = localZ / scale;
    
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    
    if (x0 < 0 || x0 >= CHUNK_SIZE - 1 || z0 < 0 || z0 >= CHUNK_SIZE - 1) {
      return -Infinity;
    }
    
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = gx - x0;
    const tz = gz - z0;
    
    // Bilinear interpolation
    const i00 = (z0 * CHUNK_SIZE + x0) * 3 + 1;
    const i10 = (z0 * CHUNK_SIZE + x1) * 3 + 1;
    const i01 = (z1 * CHUNK_SIZE + x0) * 3 + 1;
    const i11 = (z1 * CHUNK_SIZE + x1) * 3 + 1;
    
    const y00 = positions.array[i00];
    const y10 = positions.array[i10];
    const y01 = positions.array[i01];
    const y11 = positions.array[i11];
    
    const y0 = y00 * (1 - tx) + y10 * tx;
    const y1 = y01 * (1 - tx) + y11 * tx;
    
    return y0 * (1 - tz) + y1 * tz;
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