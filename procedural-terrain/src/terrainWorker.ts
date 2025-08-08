/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */
import { createNoise2D } from 'simplex-noise';

type Params = {
  seed: string;
  size: number; // vertices per side
  scale: number; // spacing between vertices
  baseFrequency: number;
  baseAmplitude: number;
  detailFrequency: number;
  detailAmplitude: number;
};

type WorkerResult = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  size: number;
  scale: number;
};

function xmur3(str: string) {
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

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRng(seed: string) {
  const seedFn = xmur3(seed);
  const rng = mulberry32(seedFn());
  return rng;
}

function buildGeometry(params: Params): WorkerResult {
  const { seed, size, scale, baseFrequency, baseAmplitude, detailFrequency, detailAmplitude } = params;

  const vertexCount = size * size;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);

  const useUint32 = vertexCount > 65535;
  const indices = useUint32
    ? new Uint32Array((size - 1) * (size - 1) * 6)
    : new Uint16Array((size - 1) * (size - 1) * 6);

  const rng = createSeededRng(seed);
  const noise2D = createNoise2D(rng);

  // Center the terrain around origin
  const half = (size - 1) / 2;

  // Generate positions
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const i = z * size + x;
      const px = (x - half) * scale;
      const pz = (z - half) * scale;
      const nx = x * baseFrequency;
      const nz = z * baseFrequency;
      const dx = x * detailFrequency;
      const dz = z * detailFrequency;
      const h = baseAmplitude * noise2D(nx, nz) + detailAmplitude * noise2D(dx, dz);

      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = pz;
    }
  }

  // Build indices and accumulate normals via face normals
  let ptr = 0;
  for (let z = 0; z < size - 1; z++) {
    for (let x = 0; x < size - 1; x++) {
      const a = z * size + x;
      const b = z * size + (x + 1);
      const d = (z + 1) * size + x;
      const c = (z + 1) * size + (x + 1);

      // Triangle 1 (ensure upward normal): a, d, b
      indices[ptr++] = a as any;
      indices[ptr++] = d as any;
      indices[ptr++] = b as any;

      accumulateFaceNormal(positions, normals, a, d, b);

      // Triangle 2 (ensure upward normal): b, d, c
      indices[ptr++] = b as any;
      indices[ptr++] = d as any;
      indices[ptr++] = c as any;

      accumulateFaceNormal(positions, normals, b, d, c);
    }
  }

  // Normalize accumulated vertex normals
  for (let i = 0; i < vertexCount; i++) {
    const nx = normals[i * 3 + 0];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3 + 0] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;
  }

  return { positions, normals, indices, size, scale };
}

function accumulateFaceNormal(
  positions: Float32Array,
  normals: Float32Array,
  ia: number,
  ib: number,
  ic: number
) {
  const ax = positions[ia * 3 + 0];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];

  const bx = positions[ib * 3 + 0];
  const by = positions[ib * 3 + 1];
  const bz = positions[ib * 3 + 2];

  const cx = positions[ic * 3 + 0];
  const cy = positions[ic * 3 + 1];
  const cz = positions[ic * 3 + 2];

  // Edges
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;

  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;

  // Cross product AB x AC (right-hand rule)
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;

  normals[ia * 3 + 0] += nx;
  normals[ia * 3 + 1] += ny;
  normals[ia * 3 + 2] += nz;

  normals[ib * 3 + 0] += nx;
  normals[ib * 3 + 1] += ny;
  normals[ib * 3 + 2] += nz;

  normals[ic * 3 + 0] += nx;
  normals[ic * 3 + 1] += ny;
  normals[ic * 3 + 2] += nz;
}

self.onmessage = (ev: MessageEvent<Params>) => {
  const params = ev.data;
  const result = buildGeometry(params);
  // Transfer buffers to avoid cloning cost
  (postMessage as any)(
    {
      positions: result.positions,
      normals: result.normals,
      indices: result.indices,
      size: result.size,
      scale: result.scale,
    },
    [result.positions.buffer, result.normals.buffer, result.indices.buffer]
  );
};
