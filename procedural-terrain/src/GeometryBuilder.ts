export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  // Leaf budgeting per tree
  private currentLeafCount: number = 0;
  private maxLeavesThisTree: number = Number.POSITIVE_INFINITY;
  
  // Separate arrays for dynamic geometry (leaves/bushes)
  private dynamicPositions: number[] = [];
  private dynamicNormals: number[] = [];
  private dynamicColors: number[] = [];
  private dynamicWindData: number[] = []; // Stores wind influence per vertex

  constructor() {}

  // Add a beam/cylinder between two points
  addBeam(
    from: [number, number, number],
    to: [number, number, number], 
    width: number,
    height: number,
    color: [number, number, number],
    segments: number = 6
  ) {
    const [fx, fy, fz] = from;
    const [tx, ty, tz] = to;

    // Calculate beam direction and up vector
    const dx = tx - fx;
    const dy = ty - fy;
    const dz = tz - fz;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (length < 0.001) return; // Skip zero-length beams

    // Normalized direction vector
    const dirX = dx / length;
    const dirY = dy / length;
    const dirZ = dz / length;

    // Find perpendicular vectors for the cylinder cross-section
    let upX = 0, upY = 1, upZ = 0;
    
    // If direction is too close to Y-axis, use X-axis as up
    if (Math.abs(dirY) > 0.9) {
      upX = 1; upY = 0; upZ = 0;
    }

    // Right vector = direction × up
    const rightX = dirY * upZ - dirZ * upY;
    const rightY = dirZ * upX - dirX * upZ;
    const rightZ = dirX * upY - dirY * upX;
    const rightLen = Math.sqrt(rightX * rightX + rightY * rightY + rightZ * rightZ);
    
    const normalizedRightX = rightX / rightLen;
    const normalizedRightY = rightY / rightLen;
    const normalizedRightZ = rightZ / rightLen;

    // Up vector = right × direction
    const finalUpX = normalizedRightY * dirZ - normalizedRightZ * dirY;
    const finalUpY = normalizedRightZ * dirX - normalizedRightX * dirZ;
    const finalUpZ = normalizedRightX * dirY - normalizedRightY * dirX;

    // Generate cylinder vertices
    const radiusBase = width * 0.5;
    const radiusTop = height * 0.5;

    // Bottom and top circles
    const bottomCenter = [fx, fy, fz];
    const topCenter = [tx, ty, tz];

    // Generate vertices for each segment
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;

      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cosNext = Math.cos(nextAngle);
      const sinNext = Math.sin(nextAngle);

      // Bottom circle points
      const b1x = fx + (normalizedRightX * cosA + finalUpX * sinA) * radiusBase;
      const b1y = fy + (normalizedRightY * cosA + finalUpY * sinA) * radiusBase;
      const b1z = fz + (normalizedRightZ * cosA + finalUpZ * sinA) * radiusBase;

      const b2x = fx + (normalizedRightX * cosNext + finalUpX * sinNext) * radiusBase;
      const b2y = fy + (normalizedRightY * cosNext + finalUpY * sinNext) * radiusBase;
      const b2z = fz + (normalizedRightZ * cosNext + finalUpZ * sinNext) * radiusBase;

      // Top circle points
      const t1x = tx + (normalizedRightX * cosA + finalUpX * sinA) * radiusTop;
      const t1y = ty + (normalizedRightY * cosA + finalUpY * sinA) * radiusTop;
      const t1z = tz + (normalizedRightZ * cosA + finalUpZ * sinA) * radiusTop;

      const t2x = tx + (normalizedRightX * cosNext + finalUpX * sinNext) * radiusTop;
      const t2y = ty + (normalizedRightY * cosNext + finalUpY * sinNext) * radiusTop;
      const t2z = tz + (normalizedRightZ * cosNext + finalUpZ * sinNext) * radiusTop;

      // Add two triangles for this segment (flat shaded)
      // Triangle 1: b1, b2, t1
      this.addFlatTriangle(
        [b1x, b1y, b1z],
        [b2x, b2y, b2z], 
        [t1x, t1y, t1z],
        color
      );

      // Triangle 2: b2, t2, t1  
      this.addFlatTriangle(
        [b2x, b2y, b2z],
        [t2x, t2y, t2z],
        [t1x, t1y, t1z],
        color
      );
    }
  }

  // Choose a bark color based on seed to get variety (e.g., birch-like white)
  private chooseBarkColor(seed: number): [number, number, number] {
    const r = this.seededRandom(seed * 13.37);
    if (r < 0.2) {
      // Birch: light, slightly warm white
      return [0.85, 0.85, 0.8];
    } else if (r < 0.45) {
      // Light grey bark
      return [0.6, 0.6, 0.58];
    } else if (r < 0.75) {
      // Medium brown
      return [0.45, 0.28, 0.15];
    }
    // Darker bark
    return [0.28, 0.18, 0.1];
  }

  // Add a flat-shaded triangle
  private addFlatTriangle(
    v1: [number, number, number],
    v2: [number, number, number], 
    v3: [number, number, number],
    color: [number, number, number]
  ) {
    const [x1, y1, z1] = v1;
    const [x2, y2, z2] = v2;
    const [x3, y3, z3] = v3;

    // Calculate face normal
    const ax = x2 - x1, ay = y2 - y1, az = z2 - z1;
    const bx = x3 - x1, by = y3 - y1, bz = z3 - z1;
    
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const normalX = nx / nLen;
    const normalY = ny / nLen;
    const normalZ = nz / nLen;

    // Add vertices (3 vertices with same normal and color for flat shading)
    const vertices = [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]];
    
    for (const [x, y, z] of vertices) {
      this.positions.push(x, y, z);
      this.normals.push(normalX, normalY, normalZ);
      this.colors.push(color[0], color[1], color[2]);
    }
  }

  // Add a flat-shaded triangle to dynamic geometry with wind influence
  private addDynamicTriangle(
    v1: [number, number, number],
    v2: [number, number, number], 
    v3: [number, number, number],
    color: [number, number, number],
    windInfluence: number
  ) {
    const [x1, y1, z1] = v1;
    const [x2, y2, z2] = v2;
    const [x3, y3, z3] = v3;

    // Calculate face normal (reversed for correct winding)
    const ax = x2 - x1, ay = y2 - y1, az = z2 - z1;
    const bx = x3 - x1, by = y3 - y1, bz = z3 - z1;
    
    const nx = -(ay * bz - az * by);
    const ny = -(az * bx - ax * bz);
    const nz = -(ax * by - ay * bx);
    
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const normalX = nx / nLen;
    const normalY = ny / nLen;
    const normalZ = nz / nLen;

    // Add vertices (3 vertices with same normal, color, and wind influence for flat shading)
    const vertices = [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]];
    
    for (const [x, y, z] of vertices) {
      this.dynamicPositions.push(x, y, z);
      this.dynamicNormals.push(normalX, normalY, normalZ);
      this.dynamicColors.push(color[0], color[1], color[2]);
      this.dynamicWindData.push(windInfluence);
    }
  }

  // Generate a fractal tree using beams
  addTree(
    x: number, y: number, z: number,
    height: number,
    angle: number,
    depth: number,
    seed: number
  ) {
    const barkColor = this.chooseBarkColor(seed);
    this.generateTreeBranch(
      [x, y, z],
      [x, y + height, z],
      height,
      angle,
      depth,
      seed,
      barkColor, // Bark color varies by seed
      depth
    );
  }

  // Generate a tree with leaves (oriented stretched cubes) at branch endings
  addTreeWithLeaves(
    x: number,
    y: number,
    z: number,
    height: number,
    angle: number,
    depth: number,
    seed: number,
    leafSize: number,
    leafColor: [number, number, number]
  ) {
    const barkColor = this.chooseBarkColor(seed);
    
    // Generate static branches first
    this.generateTreeBranch(
      [x, y, z],
      [x, y + height, z],
      height,
      angle,
      depth,
      seed,
      barkColor,
      depth
    );
    
    // Generate dynamic leaves separately
    this.currentLeafCount = 0;
    this.maxLeavesThisTree = 12; // hard cap ~12 leaves per tree
    this.generateTreeLeaves(
      [x, y, z],
      [x, y + height, z],
      height,
      angle,
      depth,
      seed,
      depth,
      leafSize,
      leafColor
    );
  }

  private generateTreeBranch(
    from: [number, number, number],
    to: [number, number, number],
    length: number,
    angle: number,
    depth: number,
    seed: number,
    barkColor: [number, number, number],
    initialDepth: number,
    leafSize?: number,
    leafColor?: [number, number, number]
  ) {
    if (depth <= 0 || length < 0.5) return;

    // Split this branch into multiple small beams with slight variation
    const [fx, fy, fz] = from;
    const [txInitial, tyInitial, tzInitial] = to;
    const segmentCount = Math.max(1, Math.floor(length * 0.6)); // Fewer segments = longer units
    const baseStepX = (txInitial - fx) / segmentCount;
    const baseStepY = (tyInitial - fy) / segmentCount;
    const baseStepZ = (tzInitial - fz) / segmentCount;
    const stepLength = length / segmentCount;

    // Variation diminishes with depth (shallower branches get less variation)
    const variationDepthFactor = Math.max(0.2, Math.min(1, depth / Math.max(1, initialDepth)));
    // Increase lateral wander to widen crowns
    const directionJitterAmplitude = stepLength * 0.25 * variationDepthFactor;
    const lengthJitterAmplitude = 0.12 * variationDepthFactor; // fraction of step length

    let cx = fx;
    let cy = fy;
    let cz = fz;
    let lastDirX = 0;
    let lastDirY = 1;
    let lastDirZ = 0;

    // Make trunks/branches much thicker overall
    const minBranchWidth = 0.12;
    const baseWidth = Math.max(minBranchWidth, length * 0.35 * (depth / Math.max(1, initialDepth)));

    for (let i = 0; i < segmentCount; i++) {
      const segSeed = seed * 101 + depth * 131 + i * 197;
      const rndA = this.seededRandom(segSeed);
      const rndB = this.seededRandom(segSeed + 1);
      const rndC = this.seededRandom(segSeed + 2);

      // Slight horizontal jitter to keep overall vertical growth
      const jx = (rndA - 0.5) * 2 * directionJitterAmplitude;
      const jz = (rndB - 0.5) * 2 * directionJitterAmplitude;
      const lengthScale = 1 + (rndC - 0.5) * 2 * lengthJitterAmplitude;

      let nx = cx + baseStepX * lengthScale + jx;
      let ny = cy + baseStepY * lengthScale; // keep vertical component dominant
      let nz = cz + baseStepZ * lengthScale + jz;

      // Pull horizontal drift slightly back toward the ideal straight path to avoid one-sided bias
      const idealX = fx + baseStepX * (i + 1);
      const idealZ = fz + baseStepZ * (i + 1);
      // Reduce damping toward the ideal path so branches can drift wider
      const biasDamp = 0.02 + 0.25 * variationDepthFactor;
      nx = idealX + (nx - idealX) * biasDamp;
      nz = idealZ + (nz - idealZ) * biasDamp;

      // Ensure continuous upward growth
      const depthRatioLocal = depth / Math.max(1, initialDepth);
      const minUpStep = stepLength * (0.2 + 0.4 * depthRatioLocal); // allow near-horizontal at tips
      if (ny <= cy) ny = cy + minUpStep;

      // Cap local tilt to keep segment within a vertical cone
      const hy = ny - cy;
      const hx = nx - cx;
      const hz = nz - cz;
      const horizMag = Math.sqrt(hx * hx + hz * hz) || 0.00001;
      // Local cone cap based on depth (match child branch cap below)
      const maxAngleNearTrunk = 0.9; // ~51.6°
      const maxAngleNearLeaves = 1.35;  // ~77.4° (very wide near top)
      const depthRatioLocal2 = depth / Math.max(1, initialDepth);
      const localAngleCap = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatioLocal2;
      const allowedHoriz = Math.tan(localAngleCap) * Math.max(hy, 0.00001);
      if (horizMag > allowedHoriz) {
        const scale = allowedHoriz / horizMag;
        const adjHx = hx * scale;
        const adjHz = hz * scale;
        nx = cx + adjHx;
        nz = cz + adjHz;
      }

      // Slight taper along the branch
      const t = i / Math.max(1, segmentCount - 1);
      const segWidth = Math.max(minBranchWidth, baseWidth * (1 - t * 0.1));

      this.addBeam([cx, cy, cz], [nx, ny, nz], segWidth, segWidth * 0.85, barkColor, 6);

      // Track last direction
      lastDirX = nx - cx;
      lastDirY = ny - cy;
      lastDirZ = nz - cz;

      cx = nx;
      cy = ny;
      cz = nz;
    }

    // Leaves are now handled separately in generateTreeLeaves method

    if (depth > 1) {
      // Generate child branches (more spread, fewer but clearer)
      const numBranches = depth > 2 ? 3 : 2;
      const tx = cx, ty = cy, tz = cz; // start children from actual end of jittered branch

      for (let i = 0; i < numBranches; i++) {
        // Use seed to get deterministic random values
        const branchSeed = seed * 31 + depth * 7 + i * 13;
        const rnd1 = this.seededRandom(branchSeed);
        const rnd2 = this.seededRandom(branchSeed + 1);
        const rnd3 = this.seededRandom(branchSeed + 2);

        // Branch parameters
        const depthRatio = depth / Math.max(1, initialDepth);
        const maxAngleNearTrunk = 1.0; // ~57.3°
        const maxAngleNearLeaves = 1.35;  // ~77.4°
        const maxOffVertical = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatio;

        const angleJitter = (rnd1 - 0.5) * 2 * 0.9; // allow branching further from initial angle
        let branchAngle = angle + angleJitter;
        if (branchAngle > maxOffVertical) branchAngle = maxOffVertical;
        if (branchAngle < -maxOffVertical) branchAngle = -maxOffVertical;

        const branchLength = length * (0.65 + rnd2 * 0.35);
        // Distribute yaw evenly among siblings with small jitter to avoid directional bias
        const baseYaw = (2 * Math.PI * i) / numBranches;
        const yawJitter = (rnd3 - 0.5) * Math.PI * 0.15; // keep yaw controlled, rely on angle spread
        const branchTilt = baseYaw + yawJitter;

        // Calculate branch end position
        const branchEndX = tx + Math.sin(branchAngle) * Math.cos(branchTilt) * branchLength;
        const branchEndY = ty + Math.cos(branchAngle) * branchLength;
        const branchEndZ = tz + Math.sin(branchAngle) * Math.sin(branchTilt) * branchLength;

        // Use consistent bark color for all trunk/branch segments
        let branchColor: [number, number, number] = barkColor;

        this.generateTreeBranch(
          [tx, ty, tz],
          [branchEndX, branchEndY, branchEndZ],
          branchLength,
          branchAngle,
          depth - 1,
          branchSeed,
          branchColor,
          initialDepth,
          leafSize,
          leafColor
        );
      }
    }
  }

  // Build a more volumetric leaf cluster using multiple oriented boxes
  private addLeafCluster(
    center: [number, number, number],
    axisDir: [number, number, number],
    size: number,
    color: [number, number, number],
    seed: number,
    remainingLeaves: number
  ): number {
    const [cx, cy, cz] = center;
    let [dx, dy, dz] = axisDir;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;

    // Basis vectors
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(dy) > 0.95) { upX = 1; upY = 0; upZ = 0; }
    // right = dir x up
    let rx = dy * upZ - dz * upY;
    let ry = dz * upX - dx * upZ;
    let rz = dx * upY - dy * upX;
    const rlen = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    // true up = right x dir
    const ux = ry * dz - rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy - ry * dx;

    // Helper for jitter (kept small to avoid directional bias)
    const rand = (i: number) => this.seededRandom(seed + i) - 0.5;
    const jitter = (scale: number, i: number) => (rand(i) * 2) * scale;

    // Minimal leaf cluster - central plus two optional offsets, constrained by budget
    let addedCount = 0;
    // Central large leaf (consume 1 if available) - high wind influence
    if (remainingLeaves > 0) {
      const heightInfluence = Math.min(1.0, cy / 10.0); // Higher leaves move more
      this.addOrientedBox([cx, cy, cz], [dx, dy, dz], size * 2.2, color, 0.8 + 0.2 * heightInfluence);
      addedCount += 1;
      remainingLeaves -= 1;
    }

    // Only 2 optional offset leaves to reduce total count
    const options = [[rx, ry, rz], [ux, uy, uz]] as [number, number, number][];
    const place = (dir: [number, number, number], scale: number, off: number, jbase: number) => {
      const [ox, oy, oz] = dir;
      const px = cx + ox * off + dx * jitter(size * 0.02, jbase + 1);
      const py = cy + oy * off + dy * jitter(size * 0.02, jbase + 2);
      const pz = cz + oz * off + dz * jitter(size * 0.02, jbase + 3);
      const heightInfluence = Math.min(1.0, py / 10.0); // Higher leaves move more
      this.addOrientedBox([px, py, pz], [dx, dy, dz], scale, color, 0.7 + 0.3 * heightInfluence);
    };
    for (let i = 0; i < options.length && remainingLeaves > 0; i++) {
      // 40% chance for each optional offset leaf
      if (this.seededRandom(seed + 500 + i) < 0.6) continue;
      const dir = options[i];
      const scale = i === 0 ? size * 1.8 : size * 1.7; // wide vs tall
      const off = i === 0 ? size * 1.2 : size * 1.1;
      place(dir as [number, number, number], scale, off, 400 + i * 20);
      addedCount += 1;
      remainingLeaves -= 1;
    }
    return addedCount;
  }

  // Add an oriented stretched cube (box) centered at position, aligned to axisDir
  private addOrientedBox(
    center: [number, number, number],
    axisDir: [number, number, number],
    size: number,
    color: [number, number, number],
    windInfluence: number = 0.0
  ) {
    const [cx, cy, cz] = center;
    let [dx, dy, dz] = axisDir;
    const dirLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dirLen < 1e-4) {
      dx = 0; dy = 1; dz = 0;
    } else {
      dx /= dirLen; dy /= dirLen; dz /= dirLen;
    }

    // Build orthonormal basis: forward = dir, choose world up to construct right
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(dy) > 0.95) { upX = 1; upY = 0; upZ = 0; }
    // right = dir x up
    let rx = dy * upZ - dz * upY;
    let ry = dz * upX - dx * upZ;
    let rz = dx * upY - dy * upX;
    const rlen = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;
    // true up = right x dir
    const ux = ry * dz - rz * dy;
    const uy = rz * dx - rx * dz;
    const uz = rx * dy - ry * dx;

    // Half-sizes: make leaves close to a cube, slightly wider than tall
    const halfForward = size * 0.45;
    const halfRight = size * 0.85;
    const halfUp = size * 0.75;

    // Precompute scaled axes
    const fX = dx * halfForward, fY = dy * halfForward, fZ = dz * halfForward;
    const rX = rx * halfRight, rY = ry * halfRight, rZ = rz * halfRight;
    const uX = ux * halfUp, uY = uy * halfUp, uZ = uz * halfUp;

    // 8 corners of the box
    const corners: [number, number, number][] = [];
    const signs = [-1, 1] as const;
    for (const sf of signs) {
      for (const sr of signs) {
        for (const su of signs) {
          corners.push([
            cx + sr * rX + su * uX + sf * fX,
            cy + sr * rY + su * uY + sf * fY,
            cz + sr * rZ + su * uZ + sf * fZ,
          ]);
        }
      }
    }

    // Index mapping for readability
    const idx = (sf: number, sr: number, su: number) => {
      const iF = sf === -1 ? 0 : 1;
      const iR = sr === -1 ? 0 : 1;
      const iU = su === -1 ? 0 : 1;
      return iF * 4 + iR * 2 + iU;
    };

    // Faces (two triangles per face)
    const faces: [number, number, number][][] = [
      // Front (+F)
      [
        corners[idx(1, -1, -1)], corners[idx(1, 1, -1)], corners[idx(1, 1, 1)],
      ],
      [
        corners[idx(1, -1, -1)], corners[idx(1, 1, 1)], corners[idx(1, -1, 1)],
      ],
      // Back (-F)
      [
        corners[idx(-1, -1, -1)], corners[idx(-1, 1, 1)], corners[idx(-1, 1, -1)],
      ],
      [
        corners[idx(-1, -1, -1)], corners[idx(-1, -1, 1)], corners[idx(-1, 1, 1)],
      ],
      // Right (+R)
      [
        corners[idx(-1, 1, -1)], corners[idx(1, 1, -1)], corners[idx(1, 1, 1)],
      ],
      [
        corners[idx(-1, 1, -1)], corners[idx(1, 1, 1)], corners[idx(-1, 1, 1)],
      ],
      // Left (-R)
      [
        corners[idx(-1, -1, -1)], corners[idx(1, -1, 1)], corners[idx(1, -1, -1)],
      ],
      [
        corners[idx(-1, -1, -1)], corners[idx(-1, -1, 1)], corners[idx(1, -1, 1)],
      ],
      // Top (+U)
      [
        corners[idx(-1, -1, 1)], corners[idx(1, 1, 1)], corners[idx(1, -1, 1)],
      ],
      [
        corners[idx(-1, -1, 1)], corners[idx(-1, 1, 1)], corners[idx(1, 1, 1)],
      ],
      // Bottom (-U)
      [
        corners[idx(-1, -1, -1)], corners[idx(1, -1, -1)], corners[idx(1, 1, -1)],
      ],
      [
        corners[idx(-1, -1, -1)], corners[idx(1, 1, -1)], corners[idx(-1, 1, -1)],
      ],
    ];

    for (const tri of faces) {
      this.addDynamicTriangle(tri[0] as any, tri[1] as any, tri[2] as any, color, windInfluence);
    }
  }

  // Generate only leaves for dynamic geometry
  private generateTreeLeaves(
    from: [number, number, number],
    to: [number, number, number],
    length: number,
    angle: number,
    depth: number,
    seed: number,
    initialDepth: number,
    leafSize?: number,
    leafColor?: [number, number, number]
  ) {
    if (depth <= 0 || length < 0.5 || !leafSize || !leafColor) return;

    // Recreate the branch path to place leaves at the right positions
    const [fx, fy, fz] = from;
    const [txInitial, tyInitial, tzInitial] = to;
    const segmentCount = Math.max(1, Math.floor(length * 0.6));
    const baseStepX = (txInitial - fx) / segmentCount;
    const baseStepY = (tyInitial - fy) / segmentCount;
    const baseStepZ = (tzInitial - fz) / segmentCount;
    const stepLength = length / segmentCount;

    const variationDepthFactor = Math.max(0.2, Math.min(1, depth / Math.max(1, initialDepth)));
    const directionJitterAmplitude = stepLength * 0.25 * variationDepthFactor;
    const lengthJitterAmplitude = 0.12 * variationDepthFactor;

    let cx = fx;
    let cy = fy;
    let cz = fz;
    let lastDirX = 0;
    let lastDirY = 1;
    let lastDirZ = 0;

    // Follow the same path as the branch generation
    for (let i = 0; i < segmentCount; i++) {
      const segSeed = seed * 101 + depth * 131 + i * 197;
      const rndA = this.seededRandom(segSeed);
      const rndB = this.seededRandom(segSeed + 1);
      const rndC = this.seededRandom(segSeed + 2);

      const jx = (rndA - 0.5) * 2 * directionJitterAmplitude;
      const jz = (rndB - 0.5) * 2 * directionJitterAmplitude;
      const lengthScale = 1 + (rndC - 0.5) * 2 * lengthJitterAmplitude;

      let nx = cx + baseStepX * lengthScale + jx;
      let ny = cy + baseStepY * lengthScale;
      let nz = cz + baseStepZ * lengthScale + jz;

      const idealX = fx + baseStepX * (i + 1);
      const idealZ = fz + baseStepZ * (i + 1);
      const biasDamp = 0.02 + 0.25 * variationDepthFactor;
      nx = idealX + (nx - idealX) * biasDamp;
      nz = idealZ + (nz - idealZ) * biasDamp;

      const depthRatioLocal = depth / Math.max(1, initialDepth);
      const minUpStep = stepLength * (0.2 + 0.4 * depthRatioLocal);
      if (ny <= cy) ny = cy + minUpStep;

      const hy = ny - cy;
      const hx = nx - cx;
      const hz = nz - cz;
      const horizMag = Math.sqrt(hx * hx + hz * hz) || 0.00001;
      const maxAngleNearTrunk = 0.9;
      const maxAngleNearLeaves = 1.35;
      const depthRatioLocal2 = depth / Math.max(1, initialDepth);
      const localAngleCap = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatioLocal2;
      const allowedHoriz = Math.tan(localAngleCap) * Math.max(hy, 0.00001);
      if (horizMag > allowedHoriz) {
        const scale = allowedHoriz / horizMag;
        nx = cx + hx * scale;
        nz = cz + hz * scale;
      }

      lastDirX = nx - cx;
      lastDirY = ny - cy;
      lastDirZ = nz - cz;

      cx = nx;
      cy = ny;
      cz = nz;
    }

    // Place leaves at terminal branches
    if (depth === 1 && this.currentLeafCount < this.maxLeavesThisTree) {
      const leafSeed = seed * 917 + Math.floor(cx * 17 + cy * 23 + cz * 31);
      const presenceChance = 0.7; // 70% chance for leaves
      if (this.seededRandom(leafSeed + 999) < presenceChance) {
        const remaining = this.maxLeavesThisTree - this.currentLeafCount;
        const added = this.addLeafCluster(
          [cx, cy, cz],
          [lastDirX, lastDirY, lastDirZ],
          leafSize,
          leafColor,
          leafSeed,
          remaining
        );
        this.currentLeafCount += added;
        console.log(`Added ${added} leaves at ${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)} - total: ${this.currentLeafCount}`);
      }
    }

    // Recurse for child branches
    if (depth > 1) {
      const numBranches = depth > 2 ? 3 : 2;
      const tx = cx, ty = cy, tz = cz;

      for (let i = 0; i < numBranches; i++) {
        const branchSeed = seed * 31 + depth * 7 + i * 13;
        const rnd1 = this.seededRandom(branchSeed);
        const rnd2 = this.seededRandom(branchSeed + 1);
        const rnd3 = this.seededRandom(branchSeed + 2);

        const depthRatio = depth / Math.max(1, initialDepth);
        const maxAngleNearTrunk = 1.0;
        const maxAngleNearLeaves = 1.35;
        const maxOffVertical = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatio;

        const angleJitter = (rnd1 - 0.5) * 2 * 0.9;
        let branchAngle = angle + angleJitter;
        if (branchAngle > maxOffVertical) branchAngle = maxOffVertical;
        if (branchAngle < -maxOffVertical) branchAngle = -maxOffVertical;

        const branchLength = length * (0.65 + rnd2 * 0.35);
        const baseYaw = (2 * Math.PI * i) / numBranches;
        const yawJitter = (rnd3 - 0.5) * Math.PI * 0.15;
        const branchTilt = baseYaw + yawJitter;

        const branchEndX = tx + Math.sin(branchAngle) * Math.cos(branchTilt) * branchLength;
        const branchEndY = ty + Math.cos(branchAngle) * branchLength;
        const branchEndZ = tz + Math.sin(branchAngle) * Math.sin(branchTilt) * branchLength;

        this.generateTreeLeaves(
          [tx, ty, tz],
          [branchEndX, branchEndY, branchEndZ],
          branchLength,
          branchAngle,
          depth - 1,
          branchSeed,
          initialDepth,
          leafSize,
          leafColor
        );
      }
    }
  }

  // Add ground vegetation (bushes)
  addBush(
    x: number,
    y: number,
    z: number,
    size: number,
    color: [number, number, number],
    seed: number
  ) {
    const bushHeight = size * (0.5 + 0.5 * this.seededRandom(seed));
    const bushWidth = size * (0.8 + 0.4 * this.seededRandom(seed + 1));
    const clusterCount = Math.floor(3 + 4 * this.seededRandom(seed + 2));
    
    for (let i = 0; i < clusterCount; i++) {
      const angle = (i / clusterCount) * Math.PI * 2 + (this.seededRandom(seed + i + 10) - 0.5) * 0.5;
      const radius = bushWidth * (0.3 + 0.7 * this.seededRandom(seed + i + 20));
      const height = bushHeight * (0.5 + 0.5 * this.seededRandom(seed + i + 30));
      
      const px = x + Math.cos(angle) * radius;
      const py = y + height * 0.5;
      const pz = z + Math.sin(angle) * radius;
      
      const leafScale = size * (0.3 + 0.4 * this.seededRandom(seed + i + 40));
      const heightInfluence = Math.min(1.0, py / 5.0); // Lower bushes move less
      
      this.addOrientedBox(
        [px, py, pz],
        [0, 1, 0], // Upward facing
        leafScale,
        color,
        0.5 + 0.3 * heightInfluence // Less wind influence than tree leaves
      );
    }
  }

  // Simple seeded random function
  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // Get the built static geometry arrays (branches)
  getStaticGeometry(): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals), 
      colors: new Float32Array(this.colors)
    };
  }
  
  // Get the built dynamic geometry arrays (leaves/bushes) with wind data
  getDynamicGeometry(): { positions: Float32Array; normals: Float32Array; colors: Float32Array; windData: Float32Array } {
    return {
      positions: new Float32Array(this.dynamicPositions),
      normals: new Float32Array(this.dynamicNormals),
      colors: new Float32Array(this.dynamicColors),
      windData: new Float32Array(this.dynamicWindData)
    };
  }
  
  // Legacy method for backward compatibility
  getGeometry(): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
    return this.getStaticGeometry();
  }

  // Clear the builder for reuse
  clear() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.dynamicPositions = [];
    this.dynamicNormals = [];
    this.dynamicColors = [];
    this.dynamicWindData = [];
  }
}