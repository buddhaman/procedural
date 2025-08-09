import * as THREE from 'three';
import { Agent, buildCreature, tickAgent, V2, V3 } from './VerletPhysics';
import { CreatureRenderer } from './CreatureRenderer';
import { ChunkManager } from './ChunkManager';

export class CreatureSystem {
  private scene: THREE.Scene;
  private renderer: CreatureRenderer;
  private chunkManager: ChunkManager;
  private agents: Agent[] = []; // Multiple creatures
  private clock = new THREE.Clock();
  
  constructor(scene: THREE.Scene, chunkManager: ChunkManager) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.renderer = new CreatureRenderer(scene);
    
    // Create multiple creatures with random phenotypes
    this.agents.push(this.createCreature(42, { x: 0, y: 0 }));
    this.agents.push(this.createCreature(123, { x: 15, y: 10 }));
    this.agents.push(this.createCreature(456, { x: -12, y: 8 }));
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
  
  private createCreature(seed: number, startPos: V2): Agent {
    const params = this.getCreatureParams(seed);
    
    const agent = buildCreature(seed, params);
    agent.pos = { x: startPos.x, y: startPos.y };
    agent.orientation = Math.random() * Math.PI * 2; // Random starting orientation
    
    // Get terrain height at starting position
    const terrainHeight = this.chunkManager.getHeightAt(startPos.x, startPos.y);
    const baseHeight = Number.isFinite(terrainHeight) ? terrainHeight : 0;
    
    // Position creature on terrain at starting position
    for (const particle of agent.skeleton.particles) {
      particle.pos.x += startPos.x;
      particle.pos.z += startPos.y;
      particle.pos.y += baseHeight;
      particle.prev.x += startPos.x;
      particle.prev.z += startPos.y;
      particle.prev.y += baseHeight;
    }
    
    // Update leg foot positions to terrain
    for (const leg of agent.legs) {
      leg.footPos.x += startPos.x;
      leg.footPos.z += startPos.y;
      leg.footPos.y = baseHeight;
    }
    
    return agent;
  }
  
  private updateCreatureMovement(agent: Agent, dt: number): void {
    // Faster random wandering behavior
    agent.orientation += (Math.random() - 0.5) * 2.5 * dt; // Much faster turning - increased from 1.0 to 2.5
    
    // Move forward at faster speeds
    const baseSpeed = 4.5; // Increased from 1.5 to 4.5
    const randomSpeed = baseSpeed + (Math.random() - 0.5) * 2.0; // More speed variation
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
  
  update(playerPos: V3): void {
    const dt = Math.min(this.clock.getDelta(), 0.05); // Cap delta time
    
    // Reset renderer for new frame
    this.renderer.reset();
    
    // Create terrain height function for physics
    const getHeightAt = (x: number, z: number) => this.chunkManager.getHeightAt(x, z);
    
    // Update all creatures
    for (const agent of this.agents) {
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
  
  dispose(): void {
    this.renderer.dispose();
  }
}