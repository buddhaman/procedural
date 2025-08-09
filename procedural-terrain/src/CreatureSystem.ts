import * as THREE from 'three';
import { Agent, buildCreature, tickAgent, V2, V3 } from './VerletPhysics';
import { CreatureRenderer } from './CreatureRenderer';
import { ChunkManager } from './ChunkManager';

export class CreatureSystem {
  private scene: THREE.Scene;
  private renderer: CreatureRenderer;
  private chunkManager: ChunkManager;
  private agent: Agent; // Single creature
  private clock = new THREE.Clock();
  
  constructor(scene: THREE.Scene, chunkManager: ChunkManager) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.renderer = new CreatureRenderer(scene);
    
    // Create a single creature at the origin
    this.agent = this.createCreature();
  }
  
  private getCreatureParams(seed: number): any {
    const rng = this.seedRandom(seed);
    
    return {
      spineSegments: 4 + Math.floor(rng() * 3), // 4-6 segments
      torsoR: 0.8 + rng() * 0.4, // 0.8-1.2
      tailR: 0.3 + rng() * 0.2,  // 0.3-0.5
      baseHeight: 1.5 + rng() * 0.5, // 1.5-2.0
      segmentDX: 1.2 + rng() * 0.3, // 1.2-1.5
      limbPairs: 2, // Always 2 pairs for now
      hipY: 0.8 + rng() * 0.2, // 0.8-1.0
      kneeZ: 0.8 + rng() * 0.2, // 0.8-1.0
      kneeR: 0.4 + rng() * 0.1, // 0.4-0.5
      footX: 0.3 + rng() * 0.2, // 0.3-0.5
      footY: 1.0 + rng() * 0.3, // 1.0-1.3
      footR: 0.3 + rng() * 0.1, // 0.3-0.4
      legZ: 2.0 + rng() * 0.5, // 2.0-2.5
      stepX: 0.5 + rng() * 0.3, // 0.5-0.8
      stepY: 1.2 + rng() * 0.3, // 1.2-1.5
      stepRadius: 2.0 + rng() * 1.0, // 2.0-3.0
      headX: 1.5 + rng() * 0.3, // 1.5-1.8
      headZ: 0.3 + rng() * 0.2, // 0.3-0.5
      headR: 0.6 + rng() * 0.2, // 0.6-0.8
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
  
  private createCreature(): Agent {
    const seed = 42; // Fixed seed for consistent creature
    const params = this.getCreatureParams(seed);
    
    const agent = buildCreature(seed, params);
    agent.pos = { x: 0, y: 0 }; // Start at origin
    agent.orientation = 0;
    
    // Get terrain height at origin
    const terrainHeight = this.chunkManager.getHeightAt(0, 0);
    const baseHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
    
    // Position creature on terrain
    for (const particle of agent.skeleton.particles) {
      particle.pos.z += baseHeight; // Position on terrain
      particle.prev.z += baseHeight;
    }
    
    // Update leg foot positions to terrain
    for (const leg of agent.legs) {
      leg.footPos.z = baseHeight;
    }
    
    return agent;
  }
  
  private updateCreatureMovement(agent: Agent, dt: number): void {
    // Simple circular walking pattern around the origin
    agent.orientation += 0.5 * dt; // Turn slowly
    
    // Move forward slowly
    const moveSpeed = 3.0;
    agent.pos.x += Math.cos(agent.orientation) * moveSpeed * dt;
    agent.pos.y += Math.sin(agent.orientation) * moveSpeed * dt;
    
    // Update foot positions to terrain height
    for (const leg of agent.legs) {
      const terrainHeight = this.chunkManager.getHeightAt(leg.footPos.x, leg.footPos.y);
      if (Number.isFinite(terrainHeight)) {
        leg.footPos.z = terrainHeight;
      }
    }
  }
  
  update(playerPos: V3): void {
    const dt = Math.min(this.clock.getDelta(), 0.05); // Cap delta time
    
    // Reset renderer for new frame
    this.renderer.reset();
    
    // Update the single creature
    this.updateCreatureMovement(this.agent, dt);
    
    // Create terrain height function for physics
    const getHeightAt = (x: number, z: number) => this.chunkManager.getHeightAt(x, z);
    
    // Update creature physics with terrain collision
    tickAgent(this.agent, dt, getHeightAt);
    
    // Render the creature
    this.renderer.renderSkeleton(
      this.agent.skeleton, 
      this.agent.color, 
      this.agent.headIdx,
      { x: 0, y: 0, z: 0 }
    );
    
    // Update renderer
    this.renderer.update();
  }
  
  dispose(): void {
    this.renderer.dispose();
  }
}