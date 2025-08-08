import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import './styles.css';

// Movement settings
const CAMERA_START_Y = 50;
const MOVE_SPEED_METERS_PER_SEC = 30; // adjust to taste
const SPRINT_MULTIPLIER = 2.0; // hold Ctrl to sprint

// Nice-looking defaults
const DEFAULTS = {
  seed: 'terrain-42',
  size: 128,
  scale: 2,
  baseFrequency: 0.02,
  baseAmplitude: 20,
  detailFrequency: 0.1,
  detailAmplitude: 3,
};

type Params = typeof DEFAULTS;

type WorkerResult = {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  size: number;
  scale: number;
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [params, setParams] = useState<Params>({ ...DEFAULTS });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const container = mountRef.current!;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87c5ff); // lighter sky-like background

    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, CAMERA_START_Y, 120);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // brighter, correct color output
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new PointerLockControls(camera, renderer.domElement);

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xbfd4ff, 0x4a3f2a, 0.7);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
    dirLight.position.set(1, 1.5, 1).multiplyScalar(200);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    // Material
    const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0x7fbf7f), roughness: 0.85, metalness: 0.0 });

    // Geometry placeholder
    const geometry = new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Worker
    const worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (ev: MessageEvent<WorkerResult>) => {
      const { positions, normals, indices } = ev.data;

      // Replace geometry data
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();

      // Ensure update
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.index!.needsUpdate = true;
    };

    // Resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    // Pointer lock on click
    renderer.domElement.addEventListener('click', () => {
      controls.lock();
    });

    // Keyboard input state
    const keyState: Record<string, boolean> = {};
    const movementKeys = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'Space', // ascend
      'ShiftLeft', // descend
      'ShiftRight', // descend
      'ControlLeft', // sprint
      'ControlRight', // sprint
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      keyState[e.code] = true;
      if (movementKeys.has(e.code)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keyState[e.code] = false;
      if (movementKeys.has(e.code)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const clock = new THREE.Clock();

    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);

      // Move camera when locked
      if (controls.isLocked) {
        const isSprinting = !!(keyState['ControlLeft'] || keyState['ControlRight']);
        const moveDistance = MOVE_SPEED_METERS_PER_SEC * (isSprinting ? SPRINT_MULTIPLIER : 1) * delta;

        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();

        camera.getWorldDirection(forward);
        forward.y = 0; // keep level
        forward.normalize();
        right.copy(forward).cross(camera.up).normalize();

        const obj = controls.getObject();

        if (keyState['KeyW']) obj.position.addScaledVector(forward, moveDistance);
        if (keyState['KeyS']) obj.position.addScaledVector(forward, -moveDistance);
        if (keyState['KeyA']) obj.position.addScaledVector(right, -moveDistance);
        if (keyState['KeyD']) obj.position.addScaledVector(right, moveDistance);

        // Vertical (creative fly): Space up, Shift down
        if (keyState['Space']) obj.position.y += moveDistance;
        if (keyState['ShiftLeft'] || keyState['ShiftRight']) obj.position.y -= moveDistance;
      }

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    animate();

    // Initial generation
    worker.postMessage({ ...params });

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      worker.terminate();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  const onRegenerate = () => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ ...params });
  };

  return (
    <>
      <div ref={mountRef} style={{ position: 'fixed', inset: 0 }} />

      <div className="ui">
        <div className="row">
          <label>
            <span>seed</span>
            <input
              value={params.seed}
              onChange={(e) => setParams((p) => ({ ...p, seed: e.target.value }))}
            />
          </label>
          <label>
            <span>size</span>
            <input
              type="number"
              min={8}
              max={1024}
              step={1}
              value={params.size}
              onChange={(e) => setParams((p) => ({ ...p, size: Math.max(8, Math.min(2048, Math.floor(Number(e.target.value) || 8))) }))}
            />
          </label>
          <label>
            <span>scale</span>
            <input
              type="number"
              step={0.5}
              value={params.scale}
              onChange={(e) => setParams((p) => ({ ...p, scale: Number(e.target.value) || 1 }))}
            />
          </label>
        </div>
        <div className="row">
          <label>
            <span>baseFrequency</span>
            <input
              type="number"
              step={0.005}
              value={params.baseFrequency}
              onChange={(e) => setParams((p) => ({ ...p, baseFrequency: Number(e.target.value) || 0 }))}
            />
          </label>
          <label>
            <span>baseAmplitude</span>
            <input
              type="number"
              step={1}
              value={params.baseAmplitude}
              onChange={(e) => setParams((p) => ({ ...p, baseAmplitude: Number(e.target.value) || 0 }))}
            />
          </label>
        </div>
        <div className="row">
          <label>
            <span>detailFrequency</span>
            <input
              type="number"
              step={0.01}
              value={params.detailFrequency}
              onChange={(e) => setParams((p) => ({ ...p, detailFrequency: Number(e.target.value) || 0 }))}
            />
          </label>
          <label>
            <span>detailAmplitude</span>
            <input
              type="number"
              step={0.5}
              value={params.detailAmplitude}
              onChange={(e) => setParams((p) => ({ ...p, detailAmplitude: Number(e.target.value) || 0 }))}
            />
          </label>
        </div>
        <button onClick={onRegenerate}>Regenerate</button>
      </div>

      <div className="hint">Click canvas to lock pointer. Move: WASD, Up: Space, Down: Shift, Sprint: Ctrl.</div>
    </>
  );
}
