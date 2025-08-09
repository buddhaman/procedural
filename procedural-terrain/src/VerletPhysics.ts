import * as THREE from 'three';

// Core vector types
export type V2 = { x: number; y: number };
export type V3 = { x: number; y: number; z: number };

// Physics components
export type Particle = {
  pos: V3;
  prev: V3;
};

export type Constraint = {
  i0: number;
  i1: number;
  rest: number;
};

export type Joint = {
  pIdx: number;
  r: number;
  color: number;
};

export type Limb = {
  cIdx: number;
  w0: number;
  w1: number;
  color: number;
};

export type Skeleton = {
  particles: Particle[];
  constraints: Constraint[];
  joints: Joint[];
  limbs: Limb[];
  blink: number;
};

// Vector utilities
export function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function mul(v: V3, s: number): V3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function len(v: V3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function dist3(a: V3, b: V3): number {
  return len(sub(b, a));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mulV2to3(dir: V2, scale: number): V3 {
  return { x: dir.x * scale, y: dir.y * scale, z: 0 };
}

export function xform(center: V3, dir: V2, offset: V3): V3 {
  const cos = Math.cos(Math.atan2(dir.y, dir.x));
  const sin = Math.sin(Math.atan2(dir.y, dir.x));
  
  return {
    x: center.x + offset.x * cos - offset.y * sin,
    y: center.y + offset.x * sin + offset.y * cos,
    z: center.z + offset.z
  };
}

// Core physics functions
export function addParticle(s: Skeleton, p: V3): number {
  s.particles.push({ pos: { ...p }, prev: { ...p } });
  return s.particles.length - 1;
}

export function addConstraint(s: Skeleton, i0: number, i1: number): number {
  const rest = len(sub(s.particles[i1].pos, s.particles[i0].pos));
  s.constraints.push({ i0, i1, rest });
  return s.constraints.length - 1;
}

export function addJoint(s: Skeleton, p: V3, r: number, color: number): number {
  const idx = addParticle(s, p);
  s.joints.push({ pIdx: idx, r, color });
  return idx;
}

export function addLimbTrapezoid(s: Skeleton, i0: number, w0: number, i1: number, w1: number, color: number): void {
  const cIdx = addConstraint(s, i0, i1);
  s.limbs.push({ cIdx, w0, w1, color });
}

export function verletUpdate(p: Particle, friction = 0.96): void {
  const v = mul(sub(p.pos, p.prev), friction);
  p.prev = { ...p.pos };
  p.pos = add(p.pos, v);
}

export function solveConstraint(c: Constraint, P: Particle[]): void {
  const a = P[c.i0].pos;
  const b = P[c.i1].pos;
  const d = sub(b, a);
  const L = len(d);
  if (L <= 1e-6) return;
  
  const corr = mul(d, 0.5 * (L - c.rest) / L);
  P[c.i0].pos = add(P[c.i0].pos, corr);
  P[c.i1].pos = sub(P[c.i1].pos, corr);
}

export function updateSkeleton(s: Skeleton, getHeightAt?: (x: number, z: number) => number): void {
  // Verlet integration
  for (const p of s.particles) {
    verletUpdate(p);
  }
  
  // Constraint solving (multiple iterations for stability)
  for (let it = 0; it < 3; ++it) {
    for (const c of s.constraints) {
      solveConstraint(c, s.particles);
    }
  }
  
  // Terrain collision for all particles
  for (const p of s.particles) {
    let groundHeight = 0; // Default ground level
    
    if (getHeightAt) {
      const terrainHeight = getHeightAt(p.pos.x, p.pos.y);
      if (Number.isFinite(terrainHeight)) {
        groundHeight = terrainHeight;
      }
    }
    
    // Clamp particle to terrain
    if (p.pos.z < groundHeight) {
      p.pos.z = groundHeight;
      // Also adjust previous position to reduce bouncing
      if (p.prev.z < groundHeight) {
        p.prev.z = groundHeight;
      }
    }
  }
}

// Leg control system
export type LegCtrl = {
  jointIdx: number;
  targetOffset: V3;
  stepRadius: number;
  footPos: V3;
};

export type Agent = {
  skeleton: Skeleton;
  orientation: number;
  pos: V2;
  spine: number[];
  legs: LegCtrl[];
  headIdx: number;
  color: number;
};

// Helper to choose which spine segments get legs
function chooseSegments(N: number, hasLeg: boolean[]): number[] {
  const segments: number[] = [];
  for (let i = 0; i < Math.min(N, hasLeg.length); i++) {
    if (hasLeg[i]) {
      segments.push(i);
    }
  }
  return segments;
}

export function buildCreature(seed: number, params: any): Agent {
  const s: Skeleton = { particles: [], constraints: [], joints: [], limbs: [], blink: 0 };
  const spine: number[] = [];
  const N = params.spineSegments;
  
  // Start with neck position (like C++ code)
  let p0: V3 = { x: 0, y: 0, z: params.baseHeight };
  
  // Calculate spacing like C++ code: diff = 9.0f*scale
  const diff = params.segmentDX; // This should be the spacing between segments
  
  // Offset beginning position by diff*(n_backbones-1)/2 such that the agent is centered (from C++)
  p0 = add(p0, { x: -(N - 1) * diff / 2.0, y: 0, z: 0 });
  
  // Create spine with proper spacing
  for (let i = 0; i < N; i++) {
    const r = params.backboneRadius ? params.backboneRadius[i] : lerp(params.torsoR, params.tailR, i / (N - 1));
    const jIdx = addJoint(s, p0, r, params.color);
    spine.push(jIdx);
    
    if (i > 0) {
      const prev = spine[i - 1];
      const prevR = params.backboneRadius ? params.backboneRadius[i - 1] : r;
      addLimbTrapezoid(s, prev, prevR * 0.7, jIdx, r * 0.7, params.color); // Thinner spine limbs
    }
    
    // Move to next position with proper spacing (only if not the last segment)
    if (i < N - 1) {
      p0 = add(p0, { x: diff, y: 0, z: 0 });
    }
  }
  
  // Store target positions for legs (like C++ agent->body.target_positions)
  const targetPositions: V3[] = [];
  let targetP = { x: -(N - 1) * diff / 2.0, y: 0, z: params.baseHeight };
  for (let i = 0; i < N; i++) {
    targetPositions.push({ ...targetP });
    if (i < N - 1) {
      targetP = add(targetP, { x: diff, y: 0, z: 0 });
    }
  }
  
  // Add mirrored legs with proper spacing
  const legs: LegCtrl[] = [];
  
  // Simple leg placement - always add legs at segments based on spine length
  const legSegments: number[] = [];
  if (N >= 2) legSegments.push(Math.floor(N * 0.3)); // Front legs
  if (N >= 3) legSegments.push(Math.floor(N * 0.7)); // Back legs
  
  for (const seg of legSegments) {
    const base = s.joints[spine[seg]].pIdx;
    
    for (const dir of [-1, 1]) {
      const knee = addJoint(s, add(s.particles[base].pos, { 
        x: 0, 
        y: dir * params.hipY, 
        z: -params.kneeZ 
      }), params.kneeR || 0.5, params.color);
      
      const foot = addJoint(s, add(s.particles[base].pos, { 
        x: params.footX, 
        y: dir * params.footY, 
        z: -params.legZ 
      }), params.footR || 0.4, params.color);
      
      // Leg limbs - thinner than joints for better look
      addLimbTrapezoid(s, base, (params.torsoR || 1.0) * 0.6, knee, (params.kneeR || 0.5) * 0.6, params.color);
      addLimbTrapezoid(s, knee, (params.kneeR || 0.5) * 0.6, foot, (params.footR || 0.4) * 0.6, params.color);
      
      // Use target position for leg offset (like C++ code)
      const targetOffset = { ...targetPositions[seg] };
      targetOffset.y += dir * 2.0; // Closer to body - reduced from 3.0 to 2.0
      targetOffset.z = 0.0; // Ground level
      
      legs.push({
        jointIdx: foot,
        targetOffset: targetOffset,
        stepRadius: params.stepRadius || 2.0,
        footPos: { ...s.particles[s.joints[foot].pIdx].pos }
      });
    }
  }
  
  // Add head
  const head = addJoint(s, add(s.particles[s.joints[spine[N - 1]].pIdx].pos, {
    x: params.headX,
    y: 0,
    z: params.headZ
  }), params.headR, params.color);
  
  addLimbTrapezoid(s, spine[N - 1], (params.torsoR || 1.0) * 0.5, head, (params.headR || 0.8) * 0.5, params.color);
  
  return {
    skeleton: s,
    orientation: 0,
    pos: { x: 0, y: 0 },
    spine,
    legs,
    headIdx: head,
    color: params.color
  };
}

export function tickAgent(a: Agent, dt: number, getHeightAt?: (x: number, z: number) => number): void {
  const dir: V2 = { x: Math.cos(a.orientation), y: Math.sin(a.orientation) };
  const center: V3 = { x: a.pos.x, y: a.pos.y, z: 0 };
  
  // Better foot placement system (similar to C++ code)
  for (const leg of a.legs) {
    const j = a.skeleton.joints[leg.jointIdx].pIdx;
    const worldTarget = xform(center, dir, leg.targetOffset);
    
    // Check distance from current foot position to target (top-down view)
    const footDist2D = Math.sqrt(
      Math.pow(worldTarget.x - leg.footPos.x, 2) + 
      Math.pow(worldTarget.y - leg.footPos.y, 2)
    );
    
    // Only move foot if it's too far away (prevents glitchy movement)
    if (footDist2D > leg.stepRadius) {
      // Move foot to target with small random offset in forward direction
      leg.footPos.x = worldTarget.x + dir.x * Math.random() * leg.stepRadius * 0.5;
      leg.footPos.y = worldTarget.y + dir.y * Math.random() * leg.stepRadius * 0.5;
      
      // Update foot position to terrain height
      if (getHeightAt) {
        const terrainHeight = getHeightAt(leg.footPos.x, leg.footPos.y);
        if (Number.isFinite(terrainHeight)) {
          leg.footPos.z = terrainHeight;
        }
      }
    }
    
    // Set foot particle position and lock it in place
    a.skeleton.particles[j].pos = { x: leg.footPos.x, y: leg.footPos.y, z: leg.footPos.z };
    a.skeleton.particles[j].prev = { ...a.skeleton.particles[j].pos };
  }
  
  // Simple head positioning - just keep it forward
  const h = a.skeleton.joints[a.headIdx].pIdx;
  const headTarget = add(center, { x: dir.x * 2.0, y: dir.y * 2.0, z: 2.5 });
  
  // Gentle head movement towards target
  const headCurrent = a.skeleton.particles[h].pos;
  const headDiff = sub(headTarget, headCurrent);
  a.skeleton.particles[h].pos = add(headCurrent, mul(headDiff, 0.05));
  
  // Gentle upward force to ALL particles - keeps everything up but flexible
  const upwardForce = 0.15; // Single parameter to control stiffness
  for (const particle of a.skeleton.particles) {
    particle.prev.z -= upwardForce * dt * 60;
  }
  
  // Update skeleton with terrain collision
  updateSkeleton(a.skeleton, getHeightAt);
  
  // Blinking system (like C++ code)
  if (Math.random() < 0.015) {
    a.skeleton.blink = 8; // Set blink counter (frames)
  }
  
  if (a.skeleton.blink > 0) {
    a.skeleton.blink -= dt * 60; // Decrease blink counter
    if (a.skeleton.blink < 0) a.skeleton.blink = 0;
  }
}