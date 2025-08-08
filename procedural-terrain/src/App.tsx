import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ChunkManager } from './ChunkManager';
import { CHUNK_SIZE } from './types';
import './styles.css';

// Movement settings
const CAMERA_START_Y = 50;
const MOVE_SPEED_METERS_PER_SEC = 30;
const SPRINT_MULTIPLIER = 2.0;
const EYE_HEIGHT = 2;

// Terrain generation defaults
const DEFAULTS = {
  seed: 'terrain-42',
  size: CHUNK_SIZE,
  scale: 2,
  baseFrequency: 0.02,
  baseAmplitude: 20,
  detailFrequency: 0.1,
  detailAmplitude: 3,
};

type Params = typeof DEFAULTS;

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [params, setParams] = useState<Params>({ ...DEFAULTS });
  const chunkManagerRef = useRef<ChunkManager | null>(null);

  useEffect(() => {
    const container = mountRef.current!;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87c5ff);

    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, CAMERA_START_Y, 120);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    scene.add(directionalLight);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.3);
    scene.add(ambientLight);

    // Controls
    const controls = new PointerLockControls(camera, renderer.domElement);
    scene.add(controls.getObject());

    // Initialize chunk manager
    const chunkManager = new ChunkManager(scene, 4);
    chunkManagerRef.current = chunkManager;

    // Input handling
    const keyState: Record<string, boolean> = {};
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight']);

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

    // Click to lock controls
    const onClick = () => {
      if (!controls.isLocked) {
        controls.lock();
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    // Resize handling
    const onResize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', onResize);

    const clock = new THREE.Clock();

    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);
      const cameraObject = controls.getObject();

      // Movement when controls are locked
      if (controls.isLocked) {
        const isSprinting = !!(keyState['ControlLeft'] || keyState['ControlRight']);
        const moveDistance = MOVE_SPEED_METERS_PER_SEC * (isSprinting ? SPRINT_MULTIPLIER : 1) * delta;

        // Get movement directions
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObject.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraObject.quaternion);

        // Apply movement
        if (keyState['KeyW']) cameraObject.position.addScaledVector(forward, moveDistance);
        if (keyState['KeyS']) cameraObject.position.addScaledVector(forward, -moveDistance);
        if (keyState['KeyA']) cameraObject.position.addScaledVector(right, -moveDistance);
        if (keyState['KeyD']) cameraObject.position.addScaledVector(right, moveDistance);

        // Vertical movement (creative fly)
        if (keyState['Space']) cameraObject.position.y += moveDistance;
        if (keyState['ShiftLeft'] || keyState['ShiftRight']) cameraObject.position.y -= moveDistance;

        // Clamp to terrain height
        const groundY = chunkManager.getHeightAt(cameraObject.position.x, cameraObject.position.z);
        if (Number.isFinite(groundY)) {
          const minY = (groundY as number) + EYE_HEIGHT;
          if (cameraObject.position.y < minY) cameraObject.position.y = minY;
        }
      }

      // Update chunks based on camera position
      chunkManager.updateChunks(camera.position, params);
      
      // Update water animation
      chunkManager.updateWater(clock.getElapsedTime(), camera.position);

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    animate();

    // Cleanup
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', onClick);
      
      if (chunkManagerRef.current) {
        chunkManagerRef.current.dispose();
        chunkManagerRef.current = null;
      }
      
      container.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [params]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      
      {/* Controls panel */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '20px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '12px',
        maxWidth: '300px',
      }}>
        <h3 style={{ margin: '0 0 15px 0' }}>Procedural Terrain</h3>
        
        <div style={{ marginBottom: '10px' }}>
          <label>Seed: </label>
          <input
            type="text"
            value={params.seed}
            onChange={(e) => setParams({ ...params, seed: e.target.value })}
            style={{ width: '150px', marginLeft: '10px' }}
          />
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>Base Frequency: </label>
          <input
            type="range"
            min="0.005"
            max="0.1"
            step="0.005"
            value={params.baseFrequency}
            onChange={(e) => setParams({ ...params, baseFrequency: parseFloat(e.target.value) })}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>{params.baseFrequency.toFixed(3)}</span>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>Base Amplitude: </label>
          <input
            type="range"
            min="5"
            max="50"
            step="1"
            value={params.baseAmplitude}
            onChange={(e) => setParams({ ...params, baseAmplitude: parseInt(e.target.value) })}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>{params.baseAmplitude}</span>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>Detail Frequency: </label>
          <input
            type="range"
            min="0.05"
            max="0.3"
            step="0.01"
            value={params.detailFrequency}
            onChange={(e) => setParams({ ...params, detailFrequency: parseFloat(e.target.value) })}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>{params.detailFrequency.toFixed(2)}</span>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>Detail Amplitude: </label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            value={params.detailAmplitude}
            onChange={(e) => setParams({ ...params, detailAmplitude: parseFloat(e.target.value) })}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>{params.detailAmplitude}</span>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label>Wave Strength: </label>
          <input
            type="range"
            min="0.0"
            max="1.0"
            step="0.1"
            value={chunkManagerRef.current?.waterMaterial?.uniforms?.waveStrength?.value || 0.2}
            onChange={(e) => {
              if (chunkManagerRef.current?.waterMaterial?.uniforms?.waveStrength) {
                chunkManagerRef.current.waterMaterial.uniforms.waveStrength.value = parseFloat(e.target.value);
              }
            }}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>
            {(chunkManagerRef.current?.waterMaterial?.uniforms?.waveStrength?.value || 0.2).toFixed(1)}
          </span>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>Water Opacity: </label>
          <input
            type="range"
            min="0.2"
            max="1.0"
            step="0.1"
            value={chunkManagerRef.current?.waterMaterial?.uniforms?.opacity?.value || 0.8}
            onChange={(e) => {
              if (chunkManagerRef.current?.waterMaterial?.uniforms?.opacity) {
                chunkManagerRef.current.waterMaterial.uniforms.opacity.value = parseFloat(e.target.value);
              }
            }}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>
            {(chunkManagerRef.current?.waterMaterial?.uniforms?.opacity?.value || 0.8).toFixed(1)}
          </span>
        </div>

        <div style={{ fontSize: '10px', color: '#ccc', lineHeight: '1.4' }}>
          <div>WASD: Move | Space/Shift: Up/Down</div>
          <div>Ctrl: Sprint | Click to lock mouse</div>
          <div>Animated water with shader effects</div>
        </div>
      </div>
    </div>
  );
}