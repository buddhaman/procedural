import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  const controlsRef = useRef<PointerLockControls | null>(null);
  const [params, setParams] = useState<Params>({ ...DEFAULTS });
  const [waveStrength, setWaveStrength] = useState(0.1);
  const [waterOpacity, setWaterOpacity] = useState(0.8);
  const [currentBiome, setCurrentBiome] = useState<string>('Unknown');
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0, z: 0 });
  const [biomeParams, setBiomeParams] = useState<any>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [headingDeg, setHeadingDeg] = useState<number>(0);
  const [speciesFound, setSpeciesFound] = useState<number>(0);
  const [journalEntries, setJournalEntries] = useState<string[]>([]);
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

    // Controls (Pointer lock)
    const controls = new PointerLockControls(camera, renderer.domElement);
    scene.add(controls.getObject());
    controlsRef.current = controls;
    const onLock = () => setIsLocked(true);
    const onUnlock = () => setIsLocked(false);
    controls.addEventListener('lock', onLock);
    controls.addEventListener('unlock', onUnlock);

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
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', onClick);
      controls.removeEventListener('lock', onLock);
      controls.removeEventListener('unlock', onUnlock);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      
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

  const directionText = useMemo(() => {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    const forward = new THREE.Vector3();
    const cam = controlsRef.current?.getObject?.();
    if (cam) {
      const dir = new THREE.Vector3();
      (cam as THREE.Object3D).getWorldDirection(dir);
      const radians = Math.atan2(dir.x, dir.z);
      const degrees = (THREE.MathUtils.radToDeg(radians) + 360) % 360;
      const idx = Math.round(degrees / 45) % 8;
      return `${dirs[idx]} ${Math.round(degrees)}°`;
    }
    return 'N 0°';
  }, [cameraPosition.x, cameraPosition.z]);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* HUD */}
      <div className="hud">
        <div className="title-chip">
          <h1>Field Guide</h1>
          <div className="subtitle">Explore and catalog playful creatures</div>
        </div>

        <div className="stats">
          <div className="stat-card">
            <h4>Location</h4>
            <div className="kv">
              <div className="k">Biome</div>
              <div className="v">{currentBiome.charAt(0).toUpperCase() + currentBiome.slice(1)}</div>
              <div className="k">Position</div>
              <div className="v">{cameraPosition.x}, {cameraPosition.y}, {cameraPosition.z}</div>
              <div className="k">Compass</div>
              <div className="v">
                <div className="compass">
                  <span>{directionText}</span>
                  <div className="rose">
                    <div className="ticks">
                      <div className="tick">N</div>
                      <div className="tick">E</div>
                      <div className="tick">S</div>
                      <div className="tick">W</div>
                    </div>
                    <div className="needle" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="stat-card">
            <h4>Discoveries</h4>
            <div className="kv">
              <div className="k">Species Found</div>
              <div className="v">{speciesFound}</div>
              <div className="k">Journal</div>
              <div className="v">
                <span className="pill">{journalEntries.length} entries</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hint">
          <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move • <kbd>Space</kbd>/<kbd>Shift</kbd> up/down • <kbd>Q</kbd> sprint</div>
          <div>Click to lock mouse • Explore to find creatures</div>
        </div>

        <div className="journal">
          <div className="card">
            <h3>Field Journal</h3>
            {journalEntries.length === 0 ? (
              <div className="entry">No entries yet. Explore new biomes to find creatures.</div>
            ) : (
              journalEntries.slice(0, 3).map((e, i) => (
                <div key={i} className="entry">{e}</div>
              ))
            )}
          </div>
        </div>

        {/* Reticle when locked */}
        {isLocked && <div className="reticle" />}

        {/* Dev controls removed for now */}
      </div>
    </div>
  );
}