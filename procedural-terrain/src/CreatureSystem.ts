import * as THREE from 'three';
import { Agent, buildCreature, tickAgent, V2, V3 } from './VerletPhysics';
import { CreatureRenderer } from './CreatureRenderer';
import { ChunkManager } from './ChunkManager';
import { CHUNK_WORLD_SIZE, RENDER_DISTANCE } from './types';

type ChunkId = string; // "x,z" format

export class CreatureSystem {
  private scene: THREE.Scene;
  private renderer: CreatureRenderer;
  private chunkManager: ChunkManager;
  private activeCreatures: Agent[] = [];
  private activeChunks = new Set<ChunkId>();
  private clock = new THREE.Clock();
  
  // Spawning parameters
  private spawnProb = 0.3; // Probability per spawn attempt - increased for testing
  private spawnAttemptsPerChunk = 12; // How many spawn attempts per chunk
  private maxCreaturesTotal = 50; // Prevent too many creatures
  
  constructor(scene: THREE.Scene, chunkManager: ChunkManager) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.renderer = new CreatureRenderer(scene);
  }
  
  private getCreatureParams(seed: number): any {
    const rng = this.seedRandom(seed);
    
    return {
      spineSegments: 3 + Math.floor(rng() * 2), // 3-4 segments
      torsoR: 0.8 + rng() * 0.4, // 0.8-1.2
      tailR: 0.4 + rng() * 0.2,  // 0.4-0.6
      baseHeight: 2.0,
      segmentDX: 2.2, // Longer spine segments
      limbPairs: 2,
      hipY: 0.7 + rng() * 0.2, // 0.7-0.9 (closer to body)
      kneeZ: 1.0 + rng() * 0.3, // 1.0-1.3
      kneeR: 0.4 + rng() * 0.2, // 0.4-0.6
      footX: 0.3 + rng() * 0.2, // 0.3-0.5 (closer to body)
      footY: 0.9 + rng() * 0.3, // 0.9-1.2 (closer to body)
      footR: 0.3 + rng() * 0.2, // 0.3-0.5
      legZ: 2.0 + rng() * 0.5, // 2.0-2.5
      stepX: 0.6 + rng() * 0.3, // 0.6-0.9
      stepY: 1.4 + rng() * 0.4, // 1.4-1.8
      stepRadius: 2.0 + rng() * 1.0, // 2.0-3.0
      headX: 1.8 + rng() * 0.4, // 1.8-2.2
      headZ: 0.4 + rng() * 0.3, // 0.4-0.7
      headR: 0.8 + rng() * 0.3, // 0.8-1.1
      color: this.getRandomCreatureColor(rng)
    };
  }
  
  private getRandomCreatureColor(rng: () => number): number {
    const colors = [
      0x8B4513, // Brown
      0x2E8B57, // Sea Green
      0x4682B4, // Steel Blue
      0x8A2BE2, // Blue Violet
      0xD2691E, // Chocolate
      0x5F9EA0, // Cadet Blue
      0x9ACD32, // Yellow Green
      0xDC143C, // Crimson
    ];
    return colors[Math.floor(rng() * colors.length)];
  }
  
  private seedRandom(seed: number): () => number {
    let state = seed;
    return function() {
      state = (state * 1664525 + 1013904223) % 0x100000000;
      return (state >>> 0) / 0x100000000;
    };
  }
  
  private createCreatureAt(worldX: number, worldZ: number): Agent {
    // Generate seed based on position for consistent creature types in areas
    const seed = Math.floor(worldX * 1000 + worldZ * 31) >>> 0;
    const params = this.getCreatureParams(seed);
    
    const agent = buildCreature(seed, params);
    agent.pos = { x: worldX, y: worldZ };
    agent.orientation = (seed % 1000) / 1000 * Math.PI * 2; // Deterministic orientation
    
    // Get terrain height at starting position
    const terrainHeight = this.chunkManager.getHeightAt(worldX, worldZ);
    const baseHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
    
    // Position creature on terrain at starting position
    for (const particle of agent.skeleton.particles) {
      particle.pos.x += worldX;
      particle.pos.z += worldZ;
      particle.pos.y += baseHeight;
      particle.prev.x += worldX;
      particle.prev.z += worldZ;
      particle.prev.y += baseHeight;
    }
    
    // Update leg foot positions to terrain
    for (const leg of agent.legs) {
      leg.footPos.x += worldX;
      leg.footPos.z += worldZ;
      leg.footPos.y = baseHeight;
    }
    
    return agent;
  }
  
  private updateCreatureMovement(agent: Agent, dt: number): void {
    // Faster random wandering behavior
    agent.orientation += (Math.random() - 0.5) * 2.5 * dt;
    
    // Move forward at faster speeds
    const baseSpeed = 4.5;
    const randomSpeed = baseSpeed + (Math.random() - 0.5) * 2.0;
    agent.pos.x += Math.cos(agent.orientation) * randomSpeed * dt;
    agent.pos.y += Math.sin(agent.orientation) * randomSpeed * dt;
    
    // Update foot positions to terrain height
    for (const leg of agent.legs) {
      const terrainHeight = this.chunkManager.getHeightAt(leg.footPos.x, leg.footPos.z);
      if (Number.isFinite(terrainHeight)) {
        leg.footPos.y = terrainHeight;
      }
    }
  }
  
  private spawnCreaturesInChunk(chunkX: number, chunkZ: number): void {
    if (this.activeCreatures.length >= this.maxCreaturesTotal) {
      return; // Don't spawn if we're at max capacity
    }
    
    const worldX = chunkX * CHUNK_WORLD_SIZE;
    const worldZ = chunkZ * CHUNK_WORLD_SIZE;
    
    // Generate deterministic random positions within this chunk
    const chunkSeed = (chunkX * 1000 + chunkZ) >>> 0;
    let rng = this.seedRandom(chunkSeed);
    
    let spawned = 0;
    for (let i = 0; i < this.spawnAttemptsPerChunk; i++) {
      if (rng() < this.spawnProb) {
        // Random position within chunk
        const localX = rng() * CHUNK_WORLD_SIZE;
        const localZ = rng() * CHUNK_WORLD_SIZE;
        const creatureX = worldX + localX;
        const creatureZ = worldZ + localZ;
        
        // For now, spawn everywhere to test - we'll fix height checking later
        const creature = this.createCreatureAt(creatureX, creatureZ);
        this.activeCreatures.push(creature);
        spawned++;
      }
    }
    
    if (spawned > 0) {
      console.log(`Spawned ${spawned} creatures in chunk ${chunkX},${chunkZ}`);
    }
  }
  
  private cleanupDistantCreatures(playerX: number, playerZ: number): void {
    const activeRadius = (RENDER_DISTANCE + 1) * CHUNK_WORLD_SIZE;
    
    this.activeCreatures = this.activeCreatures.filter(creature => {
      const dx = creature.pos.x - playerX;
      const dz = creature.pos.y - playerZ;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      return distance <= activeRadius;
    });
  }
  
  private updateActiveChunks(playerX: number, playerZ: number): void {
    const playerChunkX = Math.floor(playerX / CHUNK_WORLD_SIZE);
    const playerChunkZ = Math.floor(playerZ / CHUNK_WORLD_SIZE);
    
    const newActiveChunks = new Set<ChunkId>();
    
    // Determine which chunks should be active
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        const chunkId = `${chunkX},${chunkZ}`;
        newActiveChunks.add(chunkId);
        
        // If this chunk is newly active, spawn creatures in it
        if (!this.activeChunks.has(chunkId)) {
          this.spawnCreaturesInChunk(chunkX, chunkZ);
        }
      }
    }
    
    this.activeChunks = newActiveChunks;
  }
  
  update(playerPos: V3): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    
    // Update which chunks are active and spawn creatures in new chunks
    this.updateActiveChunks(playerPos.x, playerPos.z);
    
    // Clean up creatures that are too far away
    this.cleanupDistantCreatures(playerPos.x, playerPos.z);
    
    // Reset renderer for new frame
    this.renderer.reset();
    
    // Create terrain height function for physics
    const getHeightAt = (x: number, z: number) => this.chunkManager.getHeightAt(x, z);
    
    // Update all active creatures
    for (const agent of this.activeCreatures) {
      // Update movement
      this.updateCreatureMovement(agent, dt);
      
      // Update physics with terrain collision
      tickAgent(agent, dt, getHeightAt);
      
      // Render the creature
      this.renderer.renderSkeleton(
        agent.skeleton, 
        agent.color, 
        agent.headIdx,
        agent.orientation,
        { x: 0, y: 0, z: 0 }
      );
    }
    
    // Update renderer
    this.renderer.update();
  }
  
  // Getter for debugging
  getCreatureCount(): number {
    return this.activeCreatures.length;
  }
  
  dispose(): void {
    this.activeCreatures.length = 0;
    this.activeChunks.clear();
    this.renderer.dispose();
  }
}