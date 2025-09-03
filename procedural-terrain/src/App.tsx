import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { ChunkManager } from './ChunkManager';
import { CreatureSystem } from './CreatureSystem';
import { BirdSystem } from './BirdSystem';
import { CHUNK_SIZE } from './types';
import { createSkyDome } from './SkyDome';
import './styles.css';

// Movement settings
const CAMERA_START_Y = 50;
const DEV_MOVE_SPEED_METERS_PER_SEC = 150;
const PLAY_MOVE_SPEED_METERS_PER_SEC = 37.5; // 1/4 of dev speed
const SPRINT_MULTIPLIER = 2.0;
const EYE_HEIGHT = 2;
const GRAVITY_METERS_PER_SEC2 = -60;
const JUMP_VELOCITY = 22;
const MAX_FALL_SPEED = -120;

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
  const [waterOpacity, setWaterOpacity] = useState(0.4);
  // Day/Night configuration
  const [dayDurationSeconds, setDayDurationSeconds] = useState<number>(120);
  const dayDurationRef = useRef<number>(dayDurationSeconds);
  useEffect(() => { dayDurationRef.current = dayDurationSeconds; }, [dayDurationSeconds]);
  const [manualHour, setManualHour] = useState<number | null>(null); // 0..24 overrides automation when not null
  const manualHourRef = useRef<number | null>(manualHour);
  useEffect(() => { manualHourRef.current = manualHour; }, [manualHour]);
  const [currentBiome, setCurrentBiome] = useState<string>('Unknown');
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0, z: 0 });
  const [biomeParams, setBiomeParams] = useState<any>(null);
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [headingDeg, setHeadingDeg] = useState<number>(0);
  const [speciesFound, setSpeciesFound] = useState<number>(0);
  const [journalEntries, setJournalEntries] = useState<string[]>([]);
  const [creatureCount, setCreatureCount] = useState<number>(0);
  const [birdCount, setBirdCount] = useState<number>(0);
  const [flockCount, setFlockCount] = useState<number>(0);
  const chunkManagerRef = useRef<ChunkManager | null>(null);
  const creatureSystemRef = useRef<CreatureSystem | null>(null);
  const birdSystemRef = useRef<BirdSystem | null>(null);
  const lastBiomeUpdate = useRef<number>(0);
  const [fps, setFps] = useState<number>(0);
  const [avgFrameMs, setAvgFrameMs] = useState<number>(0);
  const posRealtimeRef = useRef<HTMLSpanElement | null>(null);
  const compassRealtimeRef = useRef<HTMLSpanElement | null>(null);
  const simTimeRef = useRef<HTMLSpanElement | null>(null);
  const lightDirRef = useRef<HTMLSpanElement | null>(null);
  const fpsFramesSinceUpdate = useRef<number>(0);
  const fpsAccumulatedDelta = useRef<number>(0);
  const fpsLastReportTime = useRef<number>(0);
  // Mode and simple character physics
  const [mode, setMode] = useState<'dev' | 'play'>('play');
  const modeRef = useRef<'dev' | 'play'>(mode);
  const verticalVelocityRef = useRef<number>(0);
  const isGroundedRef = useRef<boolean>(false);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const container = mountRef.current!;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 10000);
    camera.position.set(0, CAMERA_START_Y, 120);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.CineonToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Lighting
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(100, 120, 20);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 400;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    directionalLight.shadow.bias = -0.002; // More aggressive shadow acne fix
    directionalLight.shadow.normalBias = 0.05; // Additional bias for terrain surfaces
    scene.add(directionalLight);

    // Ambient light (will be dynamically adjusted with time of day)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.12);
    scene.add(ambientLight);

    // Sky dome with built-in clouds and stars
    const { mesh: skyDome, uniforms: skyUniforms } = createSkyDome(4000);
    (skyDome.material as THREE.ShaderMaterial).depthWrite = false;
    (skyDome.material as THREE.ShaderMaterial).depthTest = false;
    skyDome.renderOrder = -1000;
    scene.add(skyDome);

    // Dynamic fog (updated each frame)
    const initialFogColor = new THREE.Color(0x0b0f1a);
    scene.fog = new THREE.FogExp2(initialFogColor.getHex(), 0.0);

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
    
    // Initialize creature system
    const creatureSystem = new CreatureSystem(scene, chunkManager);
    creatureSystemRef.current = creatureSystem;
    
    // Initialize bird system - using a deterministic seed based on terrain seed
    const birdSeed = params.seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const birdSystem = new BirdSystem(scene, chunkManager, birdSeed);
    birdSystemRef.current = birdSystem;
    
    // Set initial water material values
    if (chunkManager.waterMaterial) {
      chunkManager.waterMaterial.uniforms.waveStrength.value = waveStrength;
      chunkManager.waterMaterial.uniforms.opacity.value = waterOpacity;
    }

    // Input handling
    const keyState: Record<string, boolean> = {};
    const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyQ']);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyG' && e.shiftKey) {
        e.preventDefault();
        setMode((prev) => (prev === 'dev' ? 'play' : 'dev'));
        return;
      }
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
    let timeOfDay01 = 0.35; // start morning/daytime for visibility (0..1)

    const tmpColorA = new THREE.Color();
    const tmpColorB = new THREE.Color();
    const warmSunrise = new THREE.Color(0xffa366);
    const warmDay = new THREE.Color(0xfff2cc);
    const coolMoon = new THREE.Color(0x88aaff);
    const skyZenith = new THREE.Color(0x6fb7ff);
    const skyHorizon = new THREE.Color(0xf1c27d);
    const skyNight = new THREE.Color(0x0b0f1a);
    const fogDay = new THREE.Color(0xbfd7ff);
    const fogNight = new THREE.Color(0x0b0f1a);
    const fogDawn = new THREE.Color(0xff9a73);
    const fogDusk = new THREE.Color(0x6f5aa8);

    function smoothstep(edge0: number, edge1: number, x: number) {
      const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
      return t * t * (3 - 2 * t);
    }

    function animate() {
      const delta = Math.min(clock.getDelta(), 0.05);
      const cameraObject = controls.getObject();

      // Movement when controls are locked
      if (controls.isLocked) {
        const isDev = modeRef.current === 'dev';
        const isSprinting = !!keyState['KeyQ'];
        const baseSpeed = isDev ? DEV_MOVE_SPEED_METERS_PER_SEC : PLAY_MOVE_SPEED_METERS_PER_SEC;
        const moveDistance = baseSpeed * (isSprinting ? SPRINT_MULTIPLIER : 1) * delta;

        // Get horizontal movement directions (ignore camera pitch for movement)
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraObject.quaternion);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraObject.quaternion);
        right.y = 0;
        right.normalize();

        // Apply horizontal movement
        if (keyState['KeyW']) cameraObject.position.addScaledVector(forward, moveDistance);
        if (keyState['KeyS']) cameraObject.position.addScaledVector(forward, -moveDistance);
        if (keyState['KeyA']) cameraObject.position.addScaledVector(right, -moveDistance);
        if (keyState['KeyD']) cameraObject.position.addScaledVector(right, moveDistance);

        if (isDev) {
          // Creative flying
          if (keyState['Space']) cameraObject.position.y += moveDistance;
          if (keyState['ShiftLeft'] || keyState['ShiftRight']) cameraObject.position.y -= moveDistance;
          verticalVelocityRef.current = 0;
          isGroundedRef.current = false;
        } else {
          // Play mode: gravity + jumping
          if (keyState['Space'] && isGroundedRef.current) {
            verticalVelocityRef.current = JUMP_VELOCITY;
            isGroundedRef.current = false;
          }
          verticalVelocityRef.current += GRAVITY_METERS_PER_SEC2 * delta;
          if (verticalVelocityRef.current < MAX_FALL_SPEED) verticalVelocityRef.current = MAX_FALL_SPEED;
          cameraObject.position.y += verticalVelocityRef.current * delta;
        }

        // Ground collision/clamp
        const groundY = chunkManager.getHeightAt(cameraObject.position.x, cameraObject.position.z);
        if (Number.isFinite(groundY)) {
          const minY = (groundY as number) + EYE_HEIGHT;
          if (cameraObject.position.y < minY) {
            cameraObject.position.y = minY;
            if (!isDev) {
              isGroundedRef.current = true;
              verticalVelocityRef.current = 0;
            }
          } else if (!isDev) {
            isGroundedRef.current = false;
          }
        }
      }

      // Update chunks based on camera position
      chunkManager.updateChunks(camera.position, params);
      
      // Update water animation
      const elapsed = clock.getElapsedTime();
      chunkManager.updateWater(elapsed, camera.position, params);

      // Day/Night time advancement (0..1). Manual debug slider overrides automation.
      const manual = manualHourRef.current;
      if (manual != null) {
        timeOfDay01 = (manual % 24) / 24;
      } else {
        const step = delta / Math.max(1e-3, dayDurationRef.current);
        timeOfDay01 = (timeOfDay01 + step) % 1;
      }

      // Sun/moon direction: east->west one cycle, slight tilt on Z for interest
      const theta = (timeOfDay01 - 0.25) * Math.PI * 2; // 6:00 at horizon
      const sunDir = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0.25).normalize();

      // Compute day factor from sun elevation with soft edges
      const elev01 = THREE.MathUtils.clamp(sunDir.y * 0.5 + 0.5, 0, 1);
      const dayFactor = smoothstep(0.02, 0.12, elev01);

      // Directional light color/intensity
      const twilight = THREE.MathUtils.clamp(1 - Math.abs(sunDir.y) * 6, 0, 1); // near horizon
      const sunWarm = tmpColorA.copy(warmSunrise).lerp(warmDay, dayFactor);
      const duskCool = tmpColorB.copy(coolMoon);
      const lightColor = sunWarm.clone().lerp(duskCool, 1 - dayFactor).lerp(sunWarm, twilight);
      directionalLight.color.copy(lightColor);
      directionalLight.intensity = THREE.MathUtils.lerp(0.12, 1.1, dayFactor);
      // Move light with camera for stable shadows, pointing from sunDir
      const lightDistance = 200;
      directionalLight.position.copy(camera.position).add(sunDir.clone().multiplyScalar(lightDistance));
      directionalLight.target.position.copy(camera.position);
      directionalLight.target.updateMatrixWorld();

      // Update sky dome uniforms and position with camera to avoid clipping
      skyUniforms.sunDirection.value.copy(sunDir);
      skyUniforms.time.value = clock.getElapsedTime();
      skyUniforms.zenithColor.value.copy(skyZenith);
      skyUniforms.horizonColor.value.copy(skyHorizon);
      skyUniforms.nightColor.value.copy(skyNight);
      skyDome.position.copy(camera.position);

      // Single source of truth: publish sun direction on the scene for any shaders/systems
      (scene.userData as any).sunDirection = sunDir;

      // Dynamic ambient: color + intensity follows day/night
      const ambientDay = new THREE.Color(0xffffff);
      const ambientNight = new THREE.Color(0x162033);
      ambientLight.color.copy(ambientNight.clone().lerp(ambientDay, dayFactor));
      ambientLight.intensity = THREE.MathUtils.lerp(0.15, 0.35, dayFactor);

      // Dynamic fog: color + density
      const baseFog = tmpColorA.copy(fogNight).lerp(fogDay, dayFactor);
      const warmFog = tmpColorB.copy(fogDawn);
      const coolFog = fogDusk;
      const isMorning = timeOfDay01 < 0.5;
      const twilightTint = isMorning ? warmFog : coolFog;
      const twilightAmount = twilight * 0.6;
      baseFog.lerp(twilightTint, twilightAmount);
      const fog = scene.fog as THREE.FogExp2 | null;
      if (fog) {
        fog.color.copy(baseFog);
        const densityDay = 0.00008;
        const densityNight = 0.00018;
        const densityTwilightBoost = 0.00022 * twilightAmount;
        fog.density = THREE.MathUtils.lerp(densityNight, densityDay, dayFactor) + densityTwilightBoost;
      }

      // Dev HUD: simulation time and light dir (realtime)
      if (simTimeRef.current) {
        const totalMinutes = Math.floor(timeOfDay01 * 24 * 60);
        const hh = Math.floor(totalMinutes / 60) % 24;
        const mm = totalMinutes % 60;
        simTimeRef.current.textContent = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
      }
      if (lightDirRef.current) {
        lightDirRef.current.textContent = `${sunDir.x.toFixed(2)}, ${sunDir.y.toFixed(2)}, ${sunDir.z.toFixed(2)}`;
      }

      // Realtime HUD updates (position and compass)
      const posRealtime = camera.position;
      if (posRealtimeRef.current) {
        posRealtimeRef.current.textContent = `${posRealtime.x.toFixed(1)}, ${posRealtime.y.toFixed(1)}, ${posRealtime.z.toFixed(1)}`;
      }
      if (compassRealtimeRef.current) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const radians = Math.atan2(forward.x, forward.z);
        const degrees = (THREE.MathUtils.radToDeg(radians) + 360) % 360;
        const dirs = ['N','NE','E','SE','S','SW','W','NW'];
        const idx = Math.round(degrees / 45) % 8;
        compassRealtimeRef.current.textContent = `${dirs[idx]} ${Math.round(degrees)}°`;
      }

      // Light updated above to follow camera with sun direction

      // Update creatures
      creatureSystem.update({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      });
      
      // Update birds
      birdSystem.update({
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      });
      
      // Update creature and bird counts more frequently (every frame)
      const currentCreatureCount = creatureSystem.getCreatureCount();
      if (currentCreatureCount !== creatureCount) {
        setCreatureCount(currentCreatureCount);
      }
      
      const currentBirdCount = birdSystem.getBirdCount();
      if (currentBirdCount !== birdCount) {
        setBirdCount(currentBirdCount);
      }
      
      const currentFlockCount = birdSystem.getFlockCount();
      if (currentFlockCount !== flockCount) {
        setFlockCount(currentFlockCount);
      }

      // Update UI with current biome (throttled to every 500ms)
      const currentTime = clock.getElapsedTime();
      // FPS accumulation and reporting (every ~0.5s to minimize re-renders)
      fpsFramesSinceUpdate.current += 1;
      fpsAccumulatedDelta.current += delta;
      if (currentTime - fpsLastReportTime.current >= 0.5) {
        const dt = currentTime - fpsLastReportTime.current || 1;
        const frames = fpsFramesSinceUpdate.current;
        setFps(Math.round(frames / dt));
        const avgMs = (fpsAccumulatedDelta.current / Math.max(frames, 1)) * 1000;
        setAvgFrameMs(Math.round(avgMs));
        fpsFramesSinceUpdate.current = 0;
        fpsAccumulatedDelta.current = 0;
        fpsLastReportTime.current = currentTime;
      }
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
      
      if (creatureSystemRef.current) {
        creatureSystemRef.current.dispose();
        creatureSystemRef.current = null;
      }
      
      if (birdSystemRef.current) {
        birdSystemRef.current.dispose();
        birdSystemRef.current = null;
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
              <div className="v"><span ref={posRealtimeRef as any}>{cameraPosition.x.toFixed ? `${(cameraPosition.x as any).toFixed?.(1)}` : cameraPosition.x}, {cameraPosition.y.toFixed ? `${(cameraPosition.y as any).toFixed?.(1)}` : cameraPosition.y}, {cameraPosition.z.toFixed ? `${(cameraPosition.z as any).toFixed?.(1)}` : cameraPosition.z}</span></div>
              <div className="k">Compass</div>
              <div className="v">
                <div className="compass">
                  <span ref={compassRealtimeRef as any}>{directionText}</span>
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
              <div className="k">Creatures Nearby</div>
              <div className="v">
                <span className="pill">{creatureCount}</span>
              </div>
              <div className="k">Birds Flying</div>
              <div className="v">
                <span className="pill">{birdCount} ({flockCount} flocks)</span>
              </div>
              <div className="k">Journal</div>
              <div className="v">
                <span className="pill">{journalEntries.length} entries</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hint">
          {mode === 'dev' ? (
            <>
              <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move • <kbd>Space</kbd>/<kbd>Shift</kbd> up/down • <kbd>Q</kbd> sprint</div>
              <div>Click to lock mouse • Press <kbd>Shift+G</kbd> for Play Mode</div>
            </>
          ) : (
            <>
              <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move • <kbd>Space</kbd> jump • <kbd>Q</kbd> sprint</div>
              <div>Click to lock mouse • Press <kbd>Shift+G</kbd> for Dev Mode</div>
            </>
          )}
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

        {/* Mode Toggle Button */}
        <div style={{ position: 'absolute', top: 12, right: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#cfd3e6', fontSize: 12 }}>Mode:</span>
          <button
            onClick={() => setMode((m) => (m === 'dev' ? 'play' : 'dev'))}
            style={{
              background: mode === 'dev' ? '#2d6cdf' : '#30a46c',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              padding: '6px 10px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {mode === 'dev' ? 'Dev (Shift+G)' : 'Play (Shift+G)'}
          </button>
        </div>

        {/* Dev controls */}
        {mode === 'dev' && (
          <div className="dev-panel" style={{ position: 'absolute', top: 86, left: 16 }}>
            <div className="content">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div style={{ fontWeight: 800, letterSpacing: 0.6, fontSize: 12, color: '#ffd166', textTransform: 'uppercase' }}>Dev Panel</div>
                <div style={{ fontSize: 12, color: '#cfd3e6' }}>FPS: <span style={{ color: '#fff', fontWeight: 800 }}>{fps}</span> · {avgFrameMs} ms</div>
              </div>

              <div className="kv" style={{ marginBottom: 8 }}>
                <div className="k">Sim Time</div>
                <div className="v"><span ref={simTimeRef as any}>0.000</span></div>
                <div className="k">Light Dir</div>
                <div className="v"><span ref={lightDirRef as any}>0,0,0</span></div>
              </div>

              {/* Day/Night controls */}
              <div style={{ 
                marginBottom: '12px', 
                padding: '8px', 
                background: 'rgba(255, 255, 255, 0.05)', 
                borderRadius: '8px',
                fontSize: '11px'
              }}>
                <div style={{ fontWeight: 700, color: '#ffd166', marginBottom: 6 }}>Day/Night</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ width: 110 }}>Day length (s)</label>
                  <input
                    type="number"
                    min={10}
                    max={3600}
                    step={10}
                    value={dayDurationSeconds}
                    onChange={(e) => {
                      const v = parseInt(e.target.value || '0', 10);
                      const clamped = Math.max(10, Math.min(3600, isNaN(v) ? dayDurationSeconds : v));
                      setDayDurationSeconds(clamped);
                    }}
                    style={{ width: 100 }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ width: 110 }}>Scrub hour</label>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    step={0.01}
                    onChange={(e) => setManualHour(parseFloat(e.target.value))}
                    style={{ width: 180 }}
                  />
                  <button
                    onClick={() => setManualHour(null)}
                    style={{ background: '#2d6cdf', color: 'white', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}
                    title="Return to automated cycle"
                  >Auto</button>
                </div>
              </div>

              {/* Current biome and position info */}
              <div style={{ 
                marginBottom: '12px', 
                padding: '8px', 
                background: 'rgba(255, 255, 255, 0.05)', 
                borderRadius: '8px',
                fontSize: '11px'
              }}>
                <div style={{ color: '#87CEEB', fontWeight: 700 }}>
                  Biome: {currentBiome}
                </div>
                <div style={{ color: '#ccc', marginTop: 4 }}>
                  Pos: {cameraPosition.x}, {cameraPosition.y}, {cameraPosition.z}
                </div>
              </div>

              {/* Detailed biome parameters */}
              {biomeParams && (
                <div style={{ 
                  marginBottom: '12px', 
                  padding: '8px', 
                  background: 'rgba(0, 100, 200, 0.08)', 
                  borderRadius: '8px',
                  fontSize: '10px',
                  fontFamily: 'monospace'
                }}>
                  <div style={{ color: '#87CEEB', fontWeight: 700, marginBottom: 6 }}>
                    Biome Parameters
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
                    <div>C: <span style={{ color: '#FFB347' }}>{biomeParams.continentalness.toFixed(3)}</span></div>
                    <div>E: <span style={{ color: '#FFB347' }}>{biomeParams.erosion.toFixed(3)}</span></div>
                    <div>T: <span style={{ color: '#FF6B6B' }}>{biomeParams.temperature.toFixed(3)}</span></div>
                    <div>M: <span style={{ color: '#4ECDC4' }}>{biomeParams.moisture.toFixed(3)}</span></div>
                    <div>Mmask: <span style={{ color: '#95E1D3' }}>{biomeParams.mountainMask.toFixed(3)}</span></div>
                    <div>R: <span style={{ color: '#DDA0DD' }}>{biomeParams.relief.toFixed(3)}</span></div>
                    <div>D: <span style={{ color: '#F0E68C' }}>{biomeParams.detail.toFixed(3)}</span></div>
                    <div>Base: <span style={{ color: '#98FB98' }}>{biomeParams.baseHeight.toFixed(1)}</span></div>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10 }}>
                    <div>Warped: <span style={{ color: '#FFA07A' }}>({biomeParams.warpedX.toFixed(0)}, {biomeParams.warpedY.toFixed(0)})</span></div>
                    <div>Final Height: <span style={{ color: '#90EE90' }}>{biomeParams.finalHeight.toFixed(2)}</span></div>
                  </div>
                </div>
              )}

              {/* Creatures info */}
              <div style={{ 
                marginBottom: '12px', 
                padding: '8px', 
                background: 'rgba(100, 200, 100, 0.08)', 
                borderRadius: '8px',
                fontSize: '11px'
              }}>
                <div style={{ color: '#90EE90', fontWeight: 700, marginBottom: 6 }}>
                  Active Creatures: {creatureCount}
                </div>
                <div style={{ color: '#87CEEB', fontWeight: 700, marginBottom: 6 }}>
                  Flying Birds: {birdCount} ({flockCount} flocks)
                </div>
                <div style={{ color: '#ccc' }}>
                  Spawning dynamically as you explore
                </div>
              </div>

              {/* Terrain controls */}
              <div style={{ marginBottom: 10 }}>
                <label>Seed: </label>
                <input
                  type="text"
                  value={params.seed}
                  onChange={(e) => setParams({ ...params, seed: e.target.value })}
                  style={{ width: 150, marginLeft: 10 }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}