import * as THREE from 'three';
import { InstancedRenderer } from './CreatureRenderer';
import { ChunkManager } from './ChunkManager';
import { CHUNK_WORLD_SIZE, RENDER_DISTANCE, WATER_LEVEL } from './types';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Bird {
  pos: V3;
  vel: V3;
  color: THREE.Color;
  wingPhase: number;
  wingSpeed: number;
  wingSpan: number;
  bodyLen: number;
  altitude: number;
  flockId: number;
}

export interface Flock {
  id: number;
  birds: Bird[];
  center: V3;
}

export interface BirdParams {
  spawnProbPerActivatedChunk: number;
  flockSizeRange: [number, number];
  spawnRadiusFromPlayer: [number, number];
  altitudeRange: [number, number];
  boidsR: { sep: number; ali: number; coh: number };
  boidsW: { sep: number; ali: number; coh: number; goal: number };
  maxSpeed: number;
  maxAccel: number;
  flap: { freq: number; amp: number };
}

type ChunkId = string; // "x,z" format

export class BirdSystem {
  private scene: THREE.Scene;
  private renderer: InstancedRenderer;
  private chunkManager: ChunkManager;
  private birds: Bird[] = [];
  private flocks = new Map<number, Flock>();
  private activeChunks = new Set<ChunkId>();
  private nextFlockId = 1;
  private clock = new THREE.Clock();
  private worldSeed: number;

  private readonly maxBirds = 50;
  private readonly params: BirdParams = {
    spawnProbPerActivatedChunk: 0.05,
    flockSizeRange: [6, 14],
    spawnRadiusFromPlayer: [20, 60],
    altitudeRange: [6, 18],
    boidsR: { sep: 2.0, ali: 4.0, coh: 6.0 },
    boidsW: { sep: 2.0, ali: 1.0, coh: 1.0, goal: 0.5 },
    maxSpeed: 8.0,
    maxAccel: 15.0,
    flap: { freq: 5.0, amp: 0.8 }
  };

  constructor(scene: THREE.Scene, chunkManager: ChunkManager, worldSeed: number = 12345) {
    this.scene = scene;
    this.chunkManager = chunkManager;
    this.worldSeed = worldSeed;
    this.renderer = new InstancedRenderer(scene);
  }

  private seedRandom(seed: number): () => number {
    let state = seed;
    return function() {
      state = (state * 1664525 + 1013904223) % 0x100000000;
      return (state >>> 0) / 0x100000000;
    };
  }

  private getRandomBirdColor(rng: () => number): THREE.Color {
    // Generate colors in HSV space for natural bird variety
    const hue = 0.6 + (rng() - 0.5) * 0.5; // Around blue-green with variation
    const saturation = 0.6 + rng() * 0.4; // 0.6-1.0
    const value = 0.4 + rng() * 0.4; // 0.4-0.8 for natural tones
    
    return new THREE.Color().setHSL(hue, saturation, value);
  }

  private spawnFlockNearPlayer(playerPos: V3, chunkX: number, chunkZ: number): void {
    if (this.birds.length >= this.maxBirds) return;

    // Deterministic RNG based on world seed and chunk coordinates
    const flockSeed = (this.worldSeed + chunkX * 1000 + chunkZ * 31 + this.nextFlockId) >>> 0;
    const rng = this.seedRandom(flockSeed);

    // Check spawn probability
    if (rng() > this.params.spawnProbPerActivatedChunk) return;

    // Pick spawn point biased toward player within radius range
    const minRadius = this.params.spawnRadiusFromPlayer[0];
    const maxRadius = this.params.spawnRadiusFromPlayer[1];
    
    // Square distance weighting for bias toward player
    const t = Math.sqrt(rng()); // Square root for inward bias
    const radius = minRadius + t * (maxRadius - minRadius);
    const angle = rng() * Math.PI * 2;
    
    const spawnX = playerPos.x + Math.cos(angle) * radius;
    const spawnZ = playerPos.z + Math.sin(angle) * radius;
    
    // Get ground height and set spawn altitude
    const groundHeight = this.chunkManager.getHeightAt(spawnX, spawnZ);
    if (!Number.isFinite(groundHeight) || groundHeight <= WATER_LEVEL) return;
    
    const altMin = this.params.altitudeRange[0];
    const altMax = this.params.altitudeRange[1];
    const spawnY = groundHeight + altMin + rng() * (altMax - altMin);

    // Determine flock size
    const minSize = this.params.flockSizeRange[0];
    const maxSize = this.params.flockSizeRange[1];
    const remainingCapacity = this.maxBirds - this.birds.length;
    const flockSize = Math.min(
      Math.floor(minSize + rng() * (maxSize - minSize + 1)),
      remainingCapacity
    );

    if (flockSize === 0) return;

    // Create flock
    const flock: Flock = {
      id: this.nextFlockId++,
      birds: [],
      center: { x: spawnX, y: spawnY, z: spawnZ }
    };

    // Create birds around center with small random offsets
    for (let i = 0; i < flockSize; i++) {
      const offsetRadius = 3.0; // Small offset from flock center
      const offsetAngle = rng() * Math.PI * 2;
      const offsetMagnitude = rng() * offsetRadius;
      
      const bird: Bird = {
        pos: {
          x: spawnX + Math.cos(offsetAngle) * offsetMagnitude,
          y: spawnY + (rng() - 0.5) * 2.0, // Small vertical offset
          z: spawnZ + Math.sin(offsetAngle) * offsetMagnitude
        },
        vel: {
          // Initial velocity toward player
          x: (playerPos.x - spawnX) * 0.1 + (rng() - 0.5) * 2.0,
          y: (rng() - 0.5) * 1.0,
          z: (playerPos.z - spawnZ) * 0.1 + (rng() - 0.5) * 2.0
        },
        color: this.getRandomBirdColor(rng),
        wingPhase: rng() * Math.PI * 2, // Random phase for natural flapping
        wingSpeed: 0.8 + rng() * 0.4, // 0.8-1.2
        wingSpan: 0.8 + rng() * 0.4, // 0.8-1.2
        bodyLen: 0.6 + rng() * 0.3, // 0.6-0.9
        altitude: spawnY,
        flockId: flock.id
      };

      flock.birds.push(bird);
      this.birds.push(bird);
    }

    this.flocks.set(flock.id, flock);
    console.log(`Spawned flock of ${flockSize} birds near player at (${spawnX.toFixed(1)}, ${spawnY.toFixed(1)}, ${spawnZ.toFixed(1)})`);
  }

  private updateActiveChunks(playerPos: V3): void {
    const playerChunkX = Math.floor(playerPos.x / CHUNK_WORLD_SIZE);
    const playerChunkZ = Math.floor(playerPos.z / CHUNK_WORLD_SIZE);
    
    const newActiveChunks = new Set<ChunkId>();
    
    // Determine which chunks should be active
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const chunkX = playerChunkX + dx;
        const chunkZ = playerChunkZ + dz;
        const chunkId = `${chunkX},${chunkZ}`;
        newActiveChunks.add(chunkId);
        
        // If this chunk is newly active, attempt to spawn a flock
        if (!this.activeChunks.has(chunkId)) {
          this.spawnFlockNearPlayer(playerPos, chunkX, chunkZ);
        }
      }
    }
    
    this.activeChunks = newActiveChunks;
  }

  private cullBirdsOutsideActiveRegion(playerPos: V3): void {
    const activeRadius = (RENDER_DISTANCE + 1) * CHUNK_WORLD_SIZE;
    const birdsToRemove: number[] = [];

    // Mark birds for removal if outside active region or over budget
    for (let i = 0; i < this.birds.length; i++) {
      const bird = this.birds[i];
      const dx = bird.pos.x - playerPos.x;
      const dz = bird.pos.z - playerPos.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      
      if (distance > activeRadius || this.birds.length > this.maxBirds) {
        birdsToRemove.push(i);
      }
    }

    // Remove birds in reverse order to maintain indices
    for (let i = birdsToRemove.length - 1; i >= 0; i--) {
      const birdIndex = birdsToRemove[i];
      const bird = this.birds[birdIndex];
      
      // Remove bird from its flock
      const flock = this.flocks.get(bird.flockId);
      if (flock) {
        const flockBirdIndex = flock.birds.indexOf(bird);
        if (flockBirdIndex >= 0) {
          flock.birds.splice(flockBirdIndex, 1);
        }
        
        // If flock is empty, remove it
        if (flock.birds.length === 0) {
          this.flocks.delete(bird.flockId);
        }
      }
      
      // Remove bird from main array
      this.birds.splice(birdIndex, 1);
    }

    if (birdsToRemove.length > 0 && this.birds.length > this.maxBirds) {
      console.log(`Culled ${birdsToRemove.length} birds, remaining: ${this.birds.length}`);
    }
  }

  private updateBoidsBehavior(bird: Bird, dt: number, playerPos: V3): void {
    const separation = { x: 0, y: 0, z: 0 };
    const alignment = { x: 0, y: 0, z: 0 };
    const cohesion = { x: 0, y: 0, z: 0 };
    
    let sepCount = 0, aliCount = 0, cohCount = 0;

    // Brute force neighborhood computation
    for (const other of this.birds) {
      if (other === bird) continue;

      const dx = other.pos.x - bird.pos.x;
      const dy = other.pos.y - bird.pos.y;
      const dz = other.pos.z - bird.pos.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Separation
      if (distSq < this.params.boidsR.sep * this.params.boidsR.sep && distSq > 0) {
        const dist = Math.sqrt(distSq);
        separation.x -= dx / dist;
        separation.y -= dy / dist;
        separation.z -= dz / dist;
        sepCount++;
      }

      // Alignment
      if (distSq < this.params.boidsR.ali * this.params.boidsR.ali) {
        alignment.x += other.vel.x;
        alignment.y += other.vel.y;
        alignment.z += other.vel.z;
        aliCount++;
      }

      // Cohesion
      if (distSq < this.params.boidsR.coh * this.params.boidsR.coh) {
        cohesion.x += other.pos.x;
        cohesion.y += other.pos.y;
        cohesion.z += other.pos.z;
        cohCount++;
      }
    }

    // Average and normalize behaviors
    if (sepCount > 0) {
      separation.x /= sepCount;
      separation.y /= sepCount;
      separation.z /= sepCount;
      const sepMag = Math.sqrt(separation.x * separation.x + separation.y * separation.y + separation.z * separation.z);
      if (sepMag > 0) {
        separation.x = (separation.x / sepMag) * this.params.maxSpeed;
        separation.y = (separation.y / sepMag) * this.params.maxSpeed;
        separation.z = (separation.z / sepMag) * this.params.maxSpeed;
      }
    }

    if (aliCount > 0) {
      alignment.x /= aliCount;
      alignment.y /= aliCount;
      alignment.z /= aliCount;
    }

    if (cohCount > 0) {
      cohesion.x = (cohesion.x / cohCount) - bird.pos.x;
      cohesion.y = (cohesion.y / cohCount) - bird.pos.y;
      cohesion.z = (cohesion.z / cohCount) - bird.pos.z;
    }

    // Goal: move toward a point ahead of player at bird's altitude
    const goal = {
      x: playerPos.x + Math.cos(Date.now() * 0.001) * 10, // Moving target
      y: bird.altitude,
      z: playerPos.z + Math.sin(Date.now() * 0.001) * 10
    };

    const goalDir = {
      x: goal.x - bird.pos.x,
      y: goal.y - bird.pos.y,
      z: goal.z - bird.pos.z
    };

    // Avoid getting too close to player (5m repulsion)
    const playerDist = Math.sqrt(
      (bird.pos.x - playerPos.x) ** 2 + 
      (bird.pos.y - playerPos.y) ** 2 + 
      (bird.pos.z - playerPos.z) ** 2
    );
    if (playerDist < 5) {
      const repulsion = 3.0;
      goalDir.x += (bird.pos.x - playerPos.x) / playerDist * repulsion;
      goalDir.y += (bird.pos.y - playerPos.y) / playerDist * repulsion;
      goalDir.z += (bird.pos.z - playerPos.z) / playerDist * repulsion;
    }

    // Terrain avoidance - stay above ground
    const groundHeight = this.chunkManager.getHeightAt(bird.pos.x, bird.pos.z);
    if (Number.isFinite(groundHeight)) {
      const minAltitude = groundHeight + 3.0; // Minimum 3m above ground
      if (bird.pos.y < minAltitude) {
        goalDir.y += (minAltitude - bird.pos.y) * 2.0; // Strong upward force
      }
    }

    // Calculate steering acceleration
    const acc = {
      x: separation.x * this.params.boidsW.sep +
         alignment.x * this.params.boidsW.ali +
         cohesion.x * this.params.boidsW.coh +
         goalDir.x * this.params.boidsW.goal,
      y: separation.y * this.params.boidsW.sep +
         alignment.y * this.params.boidsW.ali +
         cohesion.y * this.params.boidsW.coh +
         goalDir.y * this.params.boidsW.goal,
      z: separation.z * this.params.boidsW.sep +
         alignment.z * this.params.boidsW.ali +
         cohesion.z * this.params.boidsW.coh +
         goalDir.z * this.params.boidsW.goal
    };

    // Add small per-bird noise to break symmetry
    const noise = 0.5;
    acc.x += (Math.random() - 0.5) * noise;
    acc.y += (Math.random() - 0.5) * noise;
    acc.z += (Math.random() - 0.5) * noise;

    // Clamp acceleration
    const accMag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
    if (accMag > this.params.maxAccel) {
      acc.x = (acc.x / accMag) * this.params.maxAccel;
      acc.y = (acc.y / accMag) * this.params.maxAccel;
      acc.z = (acc.z / accMag) * this.params.maxAccel;
    }

    // Update velocity
    bird.vel.x += acc.x * dt;
    bird.vel.y += acc.y * dt;
    bird.vel.z += acc.z * dt;

    // Clamp velocity
    const velMag = Math.sqrt(bird.vel.x * bird.vel.x + bird.vel.y * bird.vel.y + bird.vel.z * bird.vel.z);
    if (velMag > this.params.maxSpeed) {
      bird.vel.x = (bird.vel.x / velMag) * this.params.maxSpeed;
      bird.vel.y = (bird.vel.y / velMag) * this.params.maxSpeed;
      bird.vel.z = (bird.vel.z / velMag) * this.params.maxSpeed;
    }

    // Update position
    bird.pos.x += bird.vel.x * dt;
    bird.pos.y += bird.vel.y * dt;
    bird.pos.z += bird.vel.z * dt;

    // Update wing flapping
    const speedFactor = Math.sqrt(bird.vel.x * bird.vel.x + bird.vel.y * bird.vel.y + bird.vel.z * bird.vel.z);
    bird.wingPhase += (bird.wingSpeed + speedFactor) * this.params.flap.freq * dt;
  }

  private renderBird(bird: Bird): void {
    // Create flight direction basis vectors
    const vel = bird.vel;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    
    if (speed < 0.1) return; // Don't render stationary birds

    // Forward direction (normalized velocity)
    const forward = { x: vel.x / speed, y: vel.y / speed, z: vel.z / speed };
    
    // Up vector (world up with slight tilt based on flight)
    const up = { x: 0, y: 1, z: 0 };
    
    // Right vector (cross product)
    const right = {
      x: up.y * forward.z - up.z * forward.y,
      y: up.z * forward.x - up.x * forward.z,
      z: up.x * forward.y - up.y * forward.x
    };
    
    // Normalize right vector
    const rightMag = Math.sqrt(right.x * right.x + right.y * right.y + right.z * right.z);
    if (rightMag > 0) {
      right.x /= rightMag;
      right.y /= rightMag;
      right.z /= rightMag;
    }
    
    // Recalculate up vector for orthogonal basis
    const upCorrected = {
      x: forward.y * right.z - forward.z * right.y,
      y: forward.z * right.x - forward.x * right.z,
      z: forward.x * right.y - forward.y * right.x
    };

    // Wing animation
    const wingAngle = Math.sin(bird.wingPhase) * this.params.flap.amp;
    const wingVerticalOffset = Math.sin(bird.wingPhase) * bird.wingSpan * 0.6;

    // Wing endpoints
    const leftWing = {
      x: bird.pos.x + right.x * (-bird.wingSpan) + upCorrected.x * wingVerticalOffset,
      y: bird.pos.y + right.y * (-bird.wingSpan) + upCorrected.y * wingVerticalOffset,
      z: bird.pos.z + right.z * (-bird.wingSpan) + upCorrected.z * wingVerticalOffset
    };

    const rightWing = {
      x: bird.pos.x + right.x * bird.wingSpan + upCorrected.x * wingVerticalOffset,
      y: bird.pos.y + right.y * bird.wingSpan + upCorrected.y * wingVerticalOffset,
      z: bird.pos.z + right.z * bird.wingSpan + upCorrected.z * wingVerticalOffset
    };

    // Body tail position
    const tail = {
      x: bird.pos.x - forward.x * bird.bodyLen * 0.6,
      y: bird.pos.y - forward.y * bird.bodyLen * 0.6,
      z: bird.pos.z - forward.z * bird.bodyLen * 0.6
    };

    // Convert to THREE.Vector3 for renderer
    const posVec = new THREE.Vector3(bird.pos.x, bird.pos.y, bird.pos.z);
    const leftWingVec = new THREE.Vector3(leftWing.x, leftWing.y, leftWing.z);
    const rightWingVec = new THREE.Vector3(rightWing.x, rightWing.y, rightWing.z);
    const tailVec = new THREE.Vector3(tail.x, tail.y, tail.z);

    // Render wings as beams
    this.renderer.renderBeam(posVec, leftWingVec, 0.1, 0.05, undefined, bird.color);
    this.renderer.renderBeam(posVec, rightWingVec, 0.1, 0.05, undefined, bird.color);

    // Render body as beam (optional, darker color)
    const bodyColor = bird.color.clone().multiplyScalar(0.7);
    this.renderer.renderBeam(tailVec, posVec, 0.08, 0.08, undefined, bodyColor);
  }

  update(playerPos: V3): void {
    const dt = Math.min(this.clock.getDelta(), 0.05); // Cap delta time

    // Update which chunks are active and spawn flocks in new chunks
    this.updateActiveChunks(playerPos);

    // Remove birds outside active region or over budget
    this.cullBirdsOutsideActiveRegion(playerPos);

    // Reset renderer for new frame
    this.renderer.reset();

    // Update all birds with boids behavior
    for (const bird of this.birds) {
      this.updateBoidsBehavior(bird, dt, playerPos);
    }

    // Render all birds
    for (const bird of this.birds) {
      this.renderBird(bird);
    }

    // Update renderer
    this.renderer.update();
  }

  getBirdCount(): number {
    return this.birds.length;
  }

  getFlockCount(): number {
    return this.flocks.size;
  }

  dispose(): void {
    this.birds.length = 0;
    this.flocks.clear();
    this.activeChunks.clear();
    this.renderer.dispose();
  }
}