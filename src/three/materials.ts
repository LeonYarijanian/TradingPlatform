import * as THREE from 'three';
import { PALETTE } from './palette';

/** Shared materials (created once; never disposed while the app runs). */
export const MATERIALS = {
  building: new THREE.MeshStandardMaterial({ color: PALETTE.building, roughness: 0.72, metalness: 0.35 }),
  buildingDark: new THREE.MeshStandardMaterial({ color: '#06061a', roughness: 0.8, metalness: 0.25 }),
  platform: new THREE.MeshStandardMaterial({ color: '#090921', roughness: 0.6, metalness: 0.4 }),
  ground: new THREE.MeshStandardMaterial({ color: '#05041a', roughness: 0.9, metalness: 0.1 }),
  support: new THREE.MeshStandardMaterial({ color: '#0d0b2a', roughness: 0.7, metalness: 0.5 }),
  edge: new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.buildingEdge).multiplyScalar(1.4), transparent: true, opacity: 0.55 }),
  tree: new THREE.MeshBasicMaterial({ color: new THREE.Color('#2ff3e6').multiplyScalar(1.15) }),
  treeTrunk: new THREE.MeshBasicMaterial({ color: '#0b3a44' }),
} as const;

export const GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(0.5, 1, 6, 1),
  plane: new THREE.PlaneGeometry(1, 1),
  sphere: new THREE.SphereGeometry(1, 32, 24),
  octa: new THREE.OctahedronGeometry(1, 0),
} as const;
