export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];

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

  // Generate a fractal tree using beams
  addTree(
    x: number, y: number, z: number,
    height: number,
    angle: number,
    depth: number,
    seed: number
  ) {
    this.generateTreeBranch(
      [x, y, z],
      [x, y + height, z],
      height,
      angle,
      depth,
      seed,
      [0.4, 0.2, 0.1], // Brown trunk color
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
    this.generateTreeBranch(
      [x, y, z],
      [x, y + height, z],
      height,
      angle,
      depth,
      seed,
      [0.4, 0.2, 0.1],
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
    color: [number, number, number],
    initialDepth: number,
    leafSize?: number,
    leafColor?: [number, number, number]
  ) {
    if (depth <= 0 || length < 0.5) return;

    // Split this branch into multiple small beams with slight variation
    const [fx, fy, fz] = from;
    const [txInitial, tyInitial, tzInitial] = to;
    const segmentCount = Math.max(1, Math.floor(length));
    const baseStepX = (txInitial - fx) / segmentCount;
    const baseStepY = (tyInitial - fy) / segmentCount;
    const baseStepZ = (tzInitial - fz) / segmentCount;
    const stepLength = length / segmentCount;

    // Variation diminishes with depth (shallower branches get less variation)
    const variationDepthFactor = Math.max(0.2, Math.min(1, depth / Math.max(1, initialDepth)));
    const directionJitterAmplitude = stepLength * 0.1 * variationDepthFactor; // moderate jitter
    const lengthJitterAmplitude = 0.1 * variationDepthFactor; // fraction of step length

    let cx = fx;
    let cy = fy;
    let cz = fz;
    let lastDirX = 0;
    let lastDirY = 1;
    let lastDirZ = 0;

    const minBranchWidth = 0.06;
    const baseWidth = Math.max(minBranchWidth, length * 0.18 * (depth / Math.max(1, initialDepth)));

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
      const biasDamp = 0.6 * (0.5 + 0.5 * variationDepthFactor); // more damping near trunk
      nx = idealX + (nx - idealX) * biasDamp;
      nz = idealZ + (nz - idealZ) * biasDamp;

      // Ensure continuous upward growth
      const minUpStep = stepLength * 0.6;
      if (ny <= cy) ny = cy + minUpStep;

      // Cap local tilt to keep segment within a vertical cone
      const hy = ny - cy;
      const hx = nx - cx;
      const hz = nz - cz;
      const horizMag = Math.sqrt(hx * hx + hz * hz) || 0.00001;
      // Local cone cap based on depth (match child branch cap below)
      const maxAngleNearTrunk = 0.55; // ~31.5°
      const maxAngleNearLeaves = 0.35; // ~20°
      const depthRatio = depth / Math.max(1, initialDepth);
      const localAngleCap = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatio;
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
      const segWidth = Math.max(minBranchWidth, baseWidth * (1 - t * 0.15));

      this.addBeam([cx, cy, cz], [nx, ny, nz], segWidth, segWidth * 0.85, color, 6);

      // Track last direction
      lastDirX = nx - cx;
      lastDirY = ny - cy;
      lastDirZ = nz - cz;

      cx = nx;
      cy = ny;
      cz = nz;
    }

    // Place a leaf at the end of terminal branches
    if (depth === 1 && leafSize !== undefined && leafColor !== undefined) {
      this.addOrientedBox([cx, cy, cz], [lastDirX, lastDirY, lastDirZ], leafSize, leafColor);
    }

    if (depth > 1) {
      // Generate child branches
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
        const maxAngleNearTrunk = 0.55; // ~31.5°
        const maxAngleNearLeaves = 0.35; // ~20°
        const maxOffVertical = maxAngleNearLeaves + (maxAngleNearTrunk - maxAngleNearLeaves) * depthRatio;

        const angleJitter = (rnd1 - 0.5) * 2 * 0.3; // ~±17° jitter
        let branchAngle = angle + angleJitter;
        if (branchAngle > maxOffVertical) branchAngle = maxOffVertical;
        if (branchAngle < -maxOffVertical) branchAngle = -maxOffVertical;

        const branchLength = length * (0.6 + rnd2 * 0.3);
        // Distribute yaw evenly among siblings with small jitter to avoid directional bias
        const baseYaw = (2 * Math.PI * i) / numBranches;
        const yawJitter = (rnd3 - 0.5) * Math.PI * 0.2;
        const branchTilt = baseYaw + yawJitter;

        // Calculate branch end position
        const branchEndX = tx + Math.sin(branchAngle) * Math.cos(branchTilt) * branchLength;
        const branchEndY = ty + Math.cos(branchAngle) * branchLength;
        const branchEndZ = tz + Math.sin(branchAngle) * Math.sin(branchTilt) * branchLength;

        // Determine branch color (green for leaves on final branches)
        let branchColor: [number, number, number];
        if (depth === 1) {
          branchColor = [
            0.2 + rnd1 * 0.3,
            0.4 + rnd2 * 0.4,
            0.1 + rnd3 * 0.2,
          ] as [number, number, number]; // Green leaves
        } else {
          branchColor = [0.3, 0.15, 0.05]; // Brown branches
        }

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

  // Add an oriented stretched cube (box) centered at position, aligned to axisDir
  private addOrientedBox(
    center: [number, number, number],
    axisDir: [number, number, number],
    size: number,
    color: [number, number, number]
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

    // Half-sizes (stretched along direction)
    const halfForward = size * 0.8;
    const halfRight = size * 0.35;
    const halfUp = size * 0.35;

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
      this.addFlatTriangle(tri[0] as any, tri[1] as any, tri[2] as any, color);
    }
  }

  // Simple seeded random function
  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  // Get the built geometry arrays
  getGeometry(): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals), 
      colors: new Float32Array(this.colors)
    };
  }

  // Clear the builder for reuse
  clear() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }
}