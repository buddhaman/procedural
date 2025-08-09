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
  
  renderSkeleton(skeleton: Skeleton, color: number, headIdx: number, offset: V3 = { x: 0, y: 0, z: 0 }): void {
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
      
      // Average width for the beam
      const avgWidth = (limb.w0 + limb.w1) / 4;
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
    
    // Render eyes if not blinking
    const shouldBlink = skeleton.blink > 2.5 && skeleton.blink < 2.7;
    if (!shouldBlink) {
      const headParticle = skeleton.particles[skeleton.joints[headIdx].pIdx];
      const headRadius = skeleton.joints[headIdx].r;
      const eyeColor = new THREE.Color(0x000000);
      
      // Left eye
      center.set(
        headParticle.pos.x + headRadius * 0.3 + offset.x,
        headParticle.pos.z + headRadius * 0.3 + offset.z,
        headParticle.pos.y + headRadius * 0.2 + offset.y
      );
      this.renderer.renderSphere(center, 0.3, eyeColor);
      
      // Right eye
      center.set(
        headParticle.pos.x + headRadius * 0.3 + offset.x,
        headParticle.pos.z + headRadius * 0.3 + offset.z,
        headParticle.pos.y - headRadius * 0.2 + offset.y
      );
      this.renderer.renderSphere(center, 0.3, eyeColor);
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