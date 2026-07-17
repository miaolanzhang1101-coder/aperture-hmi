import * as THREE from 'three'

// ── Joint definition ──
export interface JointDef {
  name: string
  axis: THREE.Vector3       // local rotation axis
  length: number            // link length to next joint
  min: number               // joint limit (radians)
  max: number               // joint limit (radians)
  angle: number             // current angle
  color: string
}

export const JOINT_DEFS: JointDef[] = [
  { name: 'J1 Base',     axis: new THREE.Vector3(0, 1, 0), length: 3.2,  min: -2.96, max: 2.96,  angle: 0,   color: '#6e6e73' },
  { name: 'J2 Shoulder', axis: new THREE.Vector3(1, 0, 0), length: 7.5,  min: -1.74, max: 2.26,  angle: 0.4, color: '#86868b' },
  { name: 'J3 Elbow',    axis: new THREE.Vector3(1, 0, 0), length: 6.5,  min: -2.44, max: 0.87,  angle: -0.6,color: '#007aff' },
  { name: 'J4 Wrist P',  axis: new THREE.Vector3(1, 0, 0), length: 2.8,  min: -1.57, max: 1.57,  angle: 0,   color: '#5856d6' },
  { name: 'J5 Wrist R',  axis: new THREE.Vector3(0, 0, 1), length: 1.2,  min: -2.09, max: 2.09,  angle: 0,   color: '#5856d6' },
  { name: 'J6 Tool',     axis: new THREE.Vector3(0, 1, 0), length: 2.0,  min: -6.28, max: 6.28,  angle: 0,   color: '#007aff' },
]

export function clampAngle(angle: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, angle))
}

export function getJointLimitRatio(joint: JointDef): number {
  const range = joint.max - joint.min
  if (range === 0) return 0.5
  return (joint.angle - joint.min) / range
}

export function isNearLimit(joint: JointDef, threshold = 0.15): boolean {
  const ratio = getJointLimitRatio(joint)
  return ratio < threshold || ratio > (1 - threshold)
}

// ── Forward kinematics ──
// Returns world-space positions of each joint + end effector
export function forwardKinematics(joints: JointDef[]): THREE.Vector3[] {
  const positions: THREE.Vector3[] = []
  const mat = new THREE.Matrix4()

  // Start at base
  positions.push(new THREE.Vector3(0, 0, 0))

  for (let i = 0; i < joints.length; i++) {
    const j = joints[i]
    // Rotate around joint axis
    const rotMat = new THREE.Matrix4().makeRotationAxis(j.axis, j.angle)
    mat.multiply(rotMat)
    // Translate along Y (up) by link length
    const transMat = new THREE.Matrix4().makeTranslation(0, j.length, 0)
    mat.multiply(transMat)

    const pos = new THREE.Vector3().setFromMatrixPosition(mat)
    positions.push(pos)
  }

  return positions
}

// ── CCD IK solver ──
// Cyclic Coordinate Descent: iterate from tip to base,
// rotating each joint to point toward the target
export function solveCCD(
  joints: JointDef[],
  target: THREE.Vector3,
  iterations = 12,
  tolerance = 0.3
): { solved: boolean; joints: JointDef[] } {
  const result = joints.map((j) => ({ ...j }))

  for (let iter = 0; iter < iterations; iter++) {
    // Check if we're close enough
    const positions = forwardKinematics(result)
    const endEffector = positions[positions.length - 1]
    const dist = endEffector.distanceTo(target)
    if (dist < tolerance) return { solved: true, joints: result }

    // Iterate from tip to base (skip J6 tool rotation, J5 wrist roll)
    for (let i = Math.min(3, result.length - 1); i >= 0; i--) {
      const positions = forwardKinematics(result)
      const jointPos = positions[i]
      const effector = positions[positions.length - 1]

      // Vector from joint to end effector
      const toEffector = effector.clone().sub(jointPos).normalize()
      // Vector from joint to target
      const toTarget = target.clone().sub(jointPos).normalize()

      // For Y-axis joints (J1 base), project onto XZ plane
      if (result[i].axis.y === 1) {
        toEffector.y = 0
        toTarget.y = 0
        if (toEffector.length() < 0.001 || toTarget.length() < 0.001) continue
        toEffector.normalize()
        toTarget.normalize()
      }

      // Angle between vectors
      let angle = Math.acos(Math.min(1, Math.max(-1, toEffector.dot(toTarget))))

      // Cross product for sign
      const cross = new THREE.Vector3().crossVectors(toEffector, toTarget)
      const sign = cross.dot(result[i].axis) >= 0 ? 1 : -1
      angle *= sign

      // Apply with damping
      result[i].angle = clampAngle(
        result[i].angle + angle * 0.6,
        result[i].min,
        result[i].max
      )
    }
  }

  return { solved: false, joints: result }
}

// ── Collision zones ──
export interface CollisionZone {
  center: THREE.Vector3
  radius: number
  label: string
  type: 'obstacle' | 'restricted' | 'human'
}

export const COLLISION_ZONES: CollisionZone[] = [
  { center: new THREE.Vector3(10, 5, 8), radius: 5, label: 'Obstacle A', type: 'obstacle' },
  { center: new THREE.Vector3(-8, 3, 12), radius: 4, label: 'Restricted Zone', type: 'restricted' },
  { center: new THREE.Vector3(6, 0, -10), radius: 6, label: 'Operator Zone', type: 'human' },
]

export interface CollisionResult {
  zoneIndex: number
  jointIndex: number
  distance: number      // distance from joint to zone surface (negative = inside)
  severity: number      // 0 = safe, 1 = critical
}

export function checkCollisions(
  jointPositions: THREE.Vector3[],
  zones: CollisionZone[]
): CollisionResult[] {
  const results: CollisionResult[] = []

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi]
    for (let ji = 0; ji < jointPositions.length; ji++) {
      const dist = jointPositions[ji].distanceTo(zone.center) - zone.radius
      if (dist < 3) {
        // Within warning range
        const severity = Math.max(0, Math.min(1, 1 - dist / 3))
        results.push({ zoneIndex: zi, jointIndex: ji, distance: dist, severity })
      }
    }
  }

  return results
}
