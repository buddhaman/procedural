import * as THREE from 'three';
import { Skeleton, V3 } from './VerletPhysics';

/**
 * Instanced renderer for efficient drawing of beams and spheres
 * This allows rendering many objects with the same geometry using GPU instancing
 */
export class InstancedRenderer {
    private scene: THREE.Scene;
    
    // Instanced meshes
    private beamMesh: THREE.InstancedMesh;
    private sphereMesh: THREE.InstancedMesh;
    private lightBeamMesh: THREE.InstancedMesh;
    
    // Instance counts
    private maxBeams: number = 1000;
    private maxSpheres: number = 10000;
    private maxLightBeams: number = 1000;
    private beamCount: number = 0;
    private sphereCount: number = 0;
    private lightBeamCount: number = 0;
    
    // Reusable objects to avoid garbage collection
    private tempMatrix: THREE.Matrix4 = new THREE.Matrix4();
    private tempQuaternion: THREE.Quaternion = new THREE.Quaternion();
    private tempPosition: THREE.Vector3 = new THREE.Vector3();
    private tempScale: THREE.Vector3 = new THREE.Vector3();
    private tempColor: THREE.Color = new THREE.Color();
    private upVector: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    
    constructor(scene: THREE.Scene) {
        this.scene = scene;
        
        // Create beam (box) geometry - a 1x1x1 box that will be scaled
        const beamGeometry = new THREE.BoxGeometry(1, 1, 1);
        const beamMaterial = new THREE.MeshToonMaterial();
        this.beamMesh = new THREE.InstancedMesh(beamGeometry, beamMaterial, this.maxBeams);
        this.beamMesh.count = 0;
        this.beamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.beamMesh.castShadow = true;
        this.beamMesh.receiveShadow = true;
        this.scene.add(this.beamMesh);
        
        // Create sphere geometry
        const sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
        const sphereMaterial = new THREE.MeshToonMaterial();
        this.sphereMesh = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, this.maxSpheres);
        this.sphereMesh.count = 0;
        this.sphereMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.sphereMesh.castShadow = true;
        this.sphereMesh.receiveShadow = true;
        this.scene.add(this.sphereMesh);
        
        // Create light beam mesh
        const lightBeamGeometry = new THREE.BoxGeometry(1, 1, 1);
        const lightBeamMaterial = new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0.5,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        
        this.lightBeamMesh = new THREE.InstancedMesh(lightBeamGeometry, lightBeamMaterial, this.maxLightBeams);
        this.lightBeamMesh.count = 0;
        this.lightBeamMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.lightBeamMesh.castShadow = false;
        this.lightBeamMesh.receiveShadow = false;
        this.scene.add(this.lightBeamMesh);
    }
    
    public reset(): void {
        this.beamCount = 0;
        this.sphereCount = 0;
        this.lightBeamCount = 0;
        this.beamMesh.count = 0;
        this.sphereMesh.count = 0;
        this.lightBeamMesh.count = 0;
    }
    
    public renderBeam(
        from: THREE.Vector3, 
        to: THREE.Vector3, 
        width: number = 0.2, 
        height: number = 0.2, 
        up: THREE.Vector3 = this.upVector,
        color: THREE.Color | number = 0xffffff
    ): void {
        if (this.beamCount >= this.maxBeams) return;
        
        this.tempPosition.copy(from).add(to).multiplyScalar(0.5);
        this.tempScale.copy(to).sub(from);
        const length = this.tempScale.length();
        this.tempScale.normalize();
        
        this.tempQuaternion.setFromUnitVectors(this.upVector, this.tempScale);
        this.tempScale.set(width, length, height);
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        
        this.beamMesh.setMatrixAt(this.beamCount, this.tempMatrix);
        
        if (typeof color === 'number') {
            this.tempColor.set(color);
        } else {
            this.tempColor.copy(color);
        }
        this.beamMesh.setColorAt(this.beamCount, this.tempColor);
        
        this.beamCount++;
        this.beamMesh.count = this.beamCount;
    }
    
    public renderSphere(
        center: THREE.Vector3, 
        radius: number = 1.0, 
        color: THREE.Color | number = 0xffffff
    ): void {
        if (this.sphereCount >= this.maxSpheres) return;
        
        this.tempPosition.copy(center);
        this.tempScale.set(radius, radius, radius);
        this.tempQuaternion.identity();
        this.tempMatrix.compose(this.tempPosition, this.tempQuaternion, this.tempScale);
        
        this.sphereMesh.setMatrixAt(this.sphereCount, this.tempMatrix);
        
        if (typeof color === 'number') {
            this.tempColor.set(color);
        } else {
            this.tempColor.copy(color);
        }
        this.sphereMesh.setColorAt(this.sphereCount, this.tempColor);
        
        this.sphereCount++;
        this.sphereMesh.count = this.sphereCount;
    }
    
    public update(): void {
        this.beamMesh.count = this.beamCount;
        this.sphereMesh.count = this.sphereCount;
        this.lightBeamMesh.count = this.lightBeamCount;

        this.beamMesh.instanceMatrix.needsUpdate = true;
        this.sphereMesh.instanceMatrix.needsUpdate = true;
        this.lightBeamMesh.instanceMatrix.needsUpdate = true;
        
        if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true;
        if (this.sphereMesh.instanceColor) this.sphereMesh.instanceColor.needsUpdate = true;
        if (this.lightBeamMesh.instanceColor) this.lightBeamMesh.instanceColor.needsUpdate = true;
    }

    public dispose(): void {
        this.beamMesh.geometry.dispose();
        if (this.beamMesh.material instanceof THREE.Material) {
            this.beamMesh.material.dispose();
        }
        this.scene.remove(this.beamMesh);
        
        this.sphereMesh.geometry.dispose();
        if (this.sphereMesh.material instanceof THREE.Material) {
            this.sphereMesh.material.dispose();
        }
        this.scene.remove(this.sphereMesh);
        
        this.lightBeamMesh.geometry.dispose();
        if (this.lightBeamMesh.material instanceof THREE.Material) {
            this.lightBeamMesh.material.dispose();
        }
        this.scene.remove(this.lightBeamMesh);
    }
}

export class CreatureRenderer {
  private renderer: InstancedRenderer;
  
  constructor(scene: THREE.Scene) {
    this.renderer = new InstancedRenderer(scene);
  }
  
  renderSkeleton(skeleton: Skeleton, color: number, headIdx: number, orientation: number, offset: V3 = { x: 0, y: 0, z: 0 }): void {
    const colorObj = new THREE.Color(color);
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const center = new THREE.Vector3();
    
    // Render all limbs as beams
    skeleton.limbs.forEach(limb => {
      const constraint = skeleton.constraints[limb.cIdx];
      const p1 = skeleton.particles[constraint.i0];
      const p2 = skeleton.particles[constraint.i1];
      
      // Convert coordinates (Y is up in Three.js, Z is forward)
      from.set(
        p1.pos.x + offset.x,
        p1.pos.z + offset.z,
        p1.pos.y + offset.y
      );
      
      to.set(
        p2.pos.x + offset.x,
        p2.pos.z + offset.z,
        p2.pos.y + offset.y
      );
      
      // Average width for the beam - make it thicker
      const avgWidth = (limb.w0 + limb.w1) / 2.5; // Increased from /4 to /2.5
      this.renderer.renderBeam(from, to, avgWidth, avgWidth, undefined, colorObj);
    });
    
    // Render all joints as spheres
    skeleton.joints.forEach(joint => {
      const particle = skeleton.particles[joint.pIdx];
      
      center.set(
        particle.pos.x + offset.x,
        particle.pos.z + offset.z,
        particle.pos.y + offset.y
      );
      
      this.renderer.renderSphere(center, joint.r, colorObj);
    });
    
    // Render cute face (like C++ code)
    this.renderFace(skeleton, headIdx, orientation, colorObj, offset);
  }
  
  private renderFace(skeleton: Skeleton, headIdx: number, orientation: number, bodyColor: THREE.Color, offset: V3): void {
    const headParticle = skeleton.particles[skeleton.joints[headIdx].pIdx];
    const headPos = new THREE.Vector3(
      headParticle.pos.x + offset.x,
      headParticle.pos.z + offset.z,
      headParticle.pos.y + offset.y
    );
    
    // Blinking logic
    const shouldBlink = skeleton.blink > 0;
    
    if (!shouldBlink) {
      // Eye parameters - properly sized relative to head
      const headRadius = skeleton.joints[headIdx].r;
      const eyeRadius = headRadius * 0.3; // About 30% of head radius (like your inspiration code)
      const pupilRadius = 0.05; // Small fixed size for pupils
      
      // Direction vectors
      const movementDir = new THREE.Vector3(Math.cos(orientation), 0, Math.sin(orientation));
      const upVector = new THREE.Vector3(0, 1, 0);
      const rightVector = new THREE.Vector3().crossVectors(upVector, movementDir).normalize();
      
      // Eye placement parameters (from your inspiration code)
      const eyeVerticalOffset = 0.1;   // Slightly above center
      const eyeHorizontalOffset = 0.45; // Left/right offset
      const eyeForwardOffset = 0.9;    // Toward front of head
      
      // Calculate positions for eyes on the head surface
      const leftEyeBasePos = new THREE.Vector3()
        .addScaledVector(rightVector, -eyeHorizontalOffset)
        .addScaledVector(upVector, eyeVerticalOffset)
        .addScaledVector(movementDir, eyeForwardOffset);
      
      leftEyeBasePos.normalize().multiplyScalar(headRadius);
      
      const rightEyeBasePos = new THREE.Vector3()
        .addScaledVector(rightVector, eyeHorizontalOffset)
        .addScaledVector(upVector, eyeVerticalOffset)
        .addScaledVector(movementDir, eyeForwardOffset);
      
      rightEyeBasePos.normalize().multiplyScalar(headRadius);
      
      // Final eye positions (relative to head center)
      const leftEyePos = headPos.clone().add(leftEyeBasePos);
      const rightEyePos = headPos.clone().add(rightEyeBasePos);
      
      // Render white eyes
      const whiteColor = new THREE.Color(0xFFFFFF);
      this.renderer.renderSphere(leftEyePos, eyeRadius, whiteColor);
      this.renderer.renderSphere(rightEyePos, eyeRadius, whiteColor);
      
      // Calculate pupil positions (slightly in front of eyes in movement direction)
      const pupilOffset = eyeRadius; // Pupils sit on the surface of eyes facing forward
      const leftPupilPos = leftEyePos.clone().add(movementDir.clone().multiplyScalar(pupilOffset));
      const rightPupilPos = rightEyePos.clone().add(movementDir.clone().multiplyScalar(pupilOffset));
      
      // Render black pupils
      const blackColor = new THREE.Color(0x000000);
      this.renderer.renderSphere(leftPupilPos, pupilRadius, blackColor);
      this.renderer.renderSphere(rightPupilPos, pupilRadius, blackColor);
    } else {
      // When blinking, render closed eyes with body color
      const headRadius = skeleton.joints[headIdx].r;
      const eyeRadius = headRadius * 0.3;
      
      // Same eye positioning as above but with body color
      const movementDir = new THREE.Vector3(Math.cos(orientation), 0, Math.sin(orientation));
      const upVector = new THREE.Vector3(0, 1, 0);
      const rightVector = new THREE.Vector3().crossVectors(upVector, movementDir).normalize();
      
      const eyeVerticalOffset = 0.1;
      const eyeHorizontalOffset = 0.45;
      const eyeForwardOffset = 0.9;
      
      const leftEyeBasePos = new THREE.Vector3()
        .addScaledVector(rightVector, -eyeHorizontalOffset)
        .addScaledVector(upVector, eyeVerticalOffset)
        .addScaledVector(movementDir, eyeForwardOffset);
      leftEyeBasePos.normalize().multiplyScalar(headRadius);
      
      const rightEyeBasePos = new THREE.Vector3()
        .addScaledVector(rightVector, eyeHorizontalOffset)
        .addScaledVector(upVector, eyeVerticalOffset)
        .addScaledVector(movementDir, eyeForwardOffset);
      rightEyeBasePos.normalize().multiplyScalar(headRadius);
      
      const leftEyePos = headPos.clone().add(leftEyeBasePos);
      const rightEyePos = headPos.clone().add(rightEyeBasePos);
      
      // Render closed eyes with body color
      this.renderer.renderSphere(leftEyePos, eyeRadius, bodyColor);
      this.renderer.renderSphere(rightEyePos, eyeRadius, bodyColor);
    }
  }
  
  reset(): void {
    this.renderer.reset();
  }
  
  update(): void {
    this.renderer.update();
  }
  
  dispose(): void {
    this.renderer.dispose();
  }
}