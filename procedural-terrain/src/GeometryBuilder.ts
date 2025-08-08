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
      [0.4, 0.2, 0.1] // Brown trunk color
    );
  }

  private generateTreeBranch(
    from: [number, number, number],
    to: [number, number, number],
    length: number,
    angle: number,
    depth: number,
    seed: number,
    color: [number, number, number]
  ) {
    if (depth <= 0 || length < 0.5) return;

    // Add the current branch beam
    const width = Math.max(0.1, length * 0.15 * (depth / 4));
    this.addBeam(from, to, width, width * 0.8, color, 6);

    if (depth > 1) {
      // Generate child branches
      const numBranches = depth > 2 ? 3 : 2;
      const [fx, fy, fz] = from;
      const [tx, ty, tz] = to;

      for (let i = 0; i < numBranches; i++) {
        // Use seed to get deterministic random values
        const branchSeed = seed * 31 + depth * 7 + i * 13;
        const rnd1 = this.seededRandom(branchSeed);
        const rnd2 = this.seededRandom(branchSeed + 1);
        const rnd3 = this.seededRandom(branchSeed + 2);

        // Branch parameters
        const branchAngle = angle + (rnd1 - 0.5) * Math.PI * 0.4;
        const branchLength = length * (0.6 + rnd2 * 0.3);
        const branchTilt = (rnd3 - 0.5) * Math.PI * 0.3;

        // Calculate branch end position
        const branchEndX = tx + Math.sin(branchAngle) * Math.cos(branchTilt) * branchLength;
        const branchEndY = ty + Math.cos(branchAngle) * branchLength;
        const branchEndZ = tz + Math.sin(branchAngle) * Math.sin(branchTilt) * branchLength;

        // Determine branch color (green for leaves on final branches)
        const branchColor = depth === 1 
          ? [0.2 + rnd1 * 0.3, 0.4 + rnd2 * 0.4, 0.1 + rnd3 * 0.2] // Green leaves
          : [0.3, 0.15, 0.05]; // Brown branches

        this.generateTreeBranch(
          [tx, ty, tz],
          [branchEndX, branchEndY, branchEndZ],
          branchLength,
          branchAngle,
          depth - 1,
          branchSeed,
          branchColor
        );
      }
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