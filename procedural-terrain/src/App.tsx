import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ChunkManager } from './ChunkManager';
import { CHUNK_SIZE } from './types';
import './styles.css';

// Movement settings
const CAMERA_START_Y = 50;
const MOVE_SPEED_METERS_PER_SEC = 150;
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
  const [waveStrength, setWaveStrength] = useState(0.1);
  const [waterOpacity, setWaterOpacity] = useState(0.8);
  const [currentBiome, setCurrentBiome] = useState<string>('Unknown');
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0, z: 0 });
  const [biomeParams, setBiomeParams] = useState<any>(null);
  const chunkManagerRef = useRef<ChunkManager | null>(null);
  const lastBiomeUpdate = useRef<number>(0);

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
    renderer.toneMappingExposure = 1.25;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
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

    // Soft ambient + sky/ground fill for colorful look
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x8f6a40, 0.7);
    scene.add(hemiLight);

    // Controls
    const controls = new PointerLockControls(camera, renderer.domElement);
    scene.add(controls.getObject());

    // Initialize chunk manager
    const chunkManager = new ChunkManager(scene, 4);
    chunkManagerRef.current = chunkManager;
    
    // Set initial water material values
    if (chunkManager.waterMaterial) {
      chunkManager.waterMaterial.uniforms.waveStrength.value = waveStrength;
      chunkManager.waterMaterial.uniforms.opacity.value = waterOpacity;
    }

    // Input handling
    const keyState: Record<string, boolean> = {};
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ']);

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
        const isSprinting = !!keyState['KeyQ'];
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
      chunkManager.updateWater(clock.getElapsedTime(), camera.position, params);

      // Update UI with current biome (throttled to every 500ms)
      const currentTime = clock.getElapsedTime();
      if (currentTime - lastBiomeUpdate.current > 0.5) {
        lastBiomeUpdate.current = currentTime;
        const pos = camera.position;
        setCameraPosition({ x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) });
        setCurrentBiome(chunkManager.getBiomeAt(pos.x, pos.z, params));
        
        // Get detailed biome parameters for debug display
        const detailedParams = chunkManager.getBiomeParamsAt(pos.x, pos.z);
        setBiomeParams(detailedParams);
      }

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
  }, [params, waveStrength, waterOpacity]);

  // Update water material uniforms when state changes
  useEffect(() => {
    if (chunkManagerRef.current?.waterMaterial) {
      chunkManagerRef.current.waterMaterial.uniforms.waveStrength.value = waveStrength;
    }
  }, [waveStrength]);

  useEffect(() => {
    if (chunkManagerRef.current?.waterMaterial) {
      chunkManagerRef.current.waterMaterial.uniforms.opacity.value = waterOpacity;
    }
  }, [waterOpacity]);

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
        
        {/* Current biome and position info */}
        <div style={{ 
          marginBottom: '15px', 
          padding: '8px', 
          background: 'rgba(255, 255, 255, 0.1)', 
          borderRadius: '4px',
          fontSize: '11px'
        }}>
          <div style={{ color: '#4CAF50', fontWeight: 'bold' }}>
            Current Biome: {currentBiome.charAt(0).toUpperCase() + currentBiome.slice(1)}
          </div>
          <div style={{ color: '#ccc', marginTop: '2px' }}>
            Position: {cameraPosition.x}, {cameraPosition.y}, {cameraPosition.z}
          </div>
        </div>

        {/* Detailed biome parameters */}
        {biomeParams && (
          <div style={{ 
            marginBottom: '15px', 
            padding: '8px', 
            background: 'rgba(0, 100, 200, 0.1)', 
            borderRadius: '4px',
            fontSize: '10px',
            fontFamily: 'monospace'
          }}>
            <div style={{ color: '#87CEEB', fontWeight: 'bold', marginBottom: '5px' }}>
              Biome Parameters (Live Debug):
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px', fontSize: '9px' }}>
              <div>C: <span style={{ color: '#FFB347' }}>{biomeParams.continentalness.toFixed(3)}</span></div>
              <div>E: <span style={{ color: '#FFB347' }}>{biomeParams.erosion.toFixed(3)}</span></div>
              <div>T: <span style={{ color: '#FF6B6B' }}>{biomeParams.temperature.toFixed(3)}</span></div>
              <div>M: <span style={{ color: '#4ECDC4' }}>{biomeParams.moisture.toFixed(3)}</span></div>
              <div>Mmask: <span style={{ color: '#95E1D3' }}>{biomeParams.mountainMask.toFixed(3)}</span></div>
              <div>R: <span style={{ color: '#DDA0DD' }}>{biomeParams.relief.toFixed(3)}</span></div>
              <div>D: <span style={{ color: '#F0E68C' }}>{biomeParams.detail.toFixed(3)}</span></div>
              <div>Base: <span style={{ color: '#98FB98' }}>{biomeParams.baseHeight.toFixed(1)}</span></div>
            </div>
            
            <div style={{ marginTop: '5px', fontSize: '9px' }}>
              <div>Warped: <span style={{ color: '#FFA07A' }}>({biomeParams.warpedX.toFixed(0)}, {biomeParams.warpedY.toFixed(0)})</span></div>
              <div>Final Height: <span style={{ color: '#90EE90' }}>{biomeParams.finalHeight.toFixed(2)}</span></div>
            </div>
            
            <div style={{ marginTop: '8px', fontSize: '8px', color: '#aaa', lineHeight: '1.2' }}>
              C=continentalness, E=erosion, T=temperature, M=moisture<br/>
              Mmask=mountain mask, R=relief, D=detail
            </div>
          </div>
        )}
        
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
            max="0.3"
            step="0.02"
            value={waveStrength}
            onChange={(e) => setWaveStrength(parseFloat(e.target.value))}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>
            {waveStrength.toFixed(2)}
          </span>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label>Water Opacity: </label>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.05"
            value={waterOpacity}
            onChange={(e) => setWaterOpacity(parseFloat(e.target.value))}
            style={{ width: '100px', marginLeft: '10px' }}
          />
          <span style={{ marginLeft: '10px' }}>
            {waterOpacity.toFixed(2)}
          </span>
        </div>

        <div style={{ fontSize: '10px', color: '#ccc', lineHeight: '1.4' }}>
          <div>WASD: Move | Space/Shift: Up/Down</div>
          <div>Q: Sprint | Click to lock mouse</div>
          <div>Flat-shaded water with terrain-based transitions</div>
        </div>
      </div>
    </div>
  );
}