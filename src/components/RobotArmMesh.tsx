import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type JointDef } from '../utils/ik'

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

interface RobotArmProps {
  joints: JointDef[]
  collisionSeverity: number  // 0-1 overall collision severity
  stopped: boolean
}

// Each segment: rendered between two joint positions
function ArmSegment({
  start, end, radius, color, severity, jointIdx
}: {
  start: THREE.Vector3; end: THREE.Vector3; radius: number
  color: string; severity: number; jointIdx: number
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(() => {
    if (!meshRef.current) return
    const dir = end.clone().sub(start)
    const len = dir.length()
    if (len < 0.01) return

    const mid = start.clone().add(end).multiplyScalar(0.5)
    meshRef.current.position.copy(mid)
    meshRef.current.scale.set(1, len, 1)
    meshRef.current.lookAt(end)
    meshRef.current.rotateX(Math.PI / 2)

    if (glowRef.current) {
      glowRef.current.position.copy(mid)
      glowRef.current.scale.set(1, len, 1)
      glowRef.current.lookAt(end)
      glowRef.current.rotateX(Math.PI / 2)
    }

    if (matRef.current) {
      const warn = severity > 0.3
      matRef.current.emissiveIntensity = lerp(matRef.current.emissiveIntensity, warn ? severity * 0.8 : 0, 0.08)
    }
  })

  return (
    <>
      <mesh ref={meshRef} castShadow>
        <cylinderGeometry args={[radius, radius * 0.9, 1, 12]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          roughness={0.35}
          metalness={0.6}
          emissive="#f06070"
          emissiveIntensity={0}
        />
      </mesh>
      {/* Glow shell for collision warning */}
      {severity > 0.1 && (
        <mesh ref={glowRef}>
          <cylinderGeometry args={[radius * 1.3, radius * 1.2, 1, 12]} />
          <meshBasicMaterial
            color="#ff3b30"
            transparent
            opacity={severity * 0.15}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  )
}

function JointBall({
  position, radius, color, isNearLimit
}: {
  position: THREE.Vector3; radius: number; color: string; isNearLimit: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (ref.current) ref.current.position.copy(position)
  })

  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[radius, 16, 12]} />
      <meshStandardMaterial
        color={isNearLimit ? '#f06070' : color}
        roughness={0.3}
        metalness={0.5}
        emissive={isNearLimit ? '#f06070' : '#000000'}
        emissiveIntensity={isNearLimit ? 0.5 : 0}
      />
    </mesh>
  )
}

export default function RobotArmMesh({ joints, collisionSeverity, stopped }: RobotArmProps) {
  const positions = useMemo(() => {
    // Compute FK positions
    const pos: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)]
    const mat = new THREE.Matrix4()
    for (const j of joints) {
      const rotMat = new THREE.Matrix4().makeRotationAxis(j.axis, j.angle)
      mat.multiply(rotMat)
      const transMat = new THREE.Matrix4().makeTranslation(0, j.length, 0)
      mat.multiply(transMat)
      pos.push(new THREE.Vector3().setFromMatrixPosition(mat))
    }
    return pos
  }, [joints])

  const radii = [1.5, 1.2, 0.9, 0.7, 0.5, 0.4]
  const segmentSeverities = useMemo(() => {
    return joints.map(() => collisionSeverity)
  }, [joints, collisionSeverity])

  return (
    <group>
      {/* Base platform */}
      <mesh position={[0, -0.6, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[3.5, 4, 1.2, 32]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.5} metalness={0.8} />
      </mesh>

      {/* Arm segments */}
      {joints.map((j, i) => (
        <ArmSegment
          key={i}
          start={positions[i]}
          end={positions[i + 1]}
          radius={radii[i] || 0.4}
          color={stopped ? '#444' : j.color}
          severity={segmentSeverities[i]}
          jointIdx={i}
        />
      ))}

      {/* Joint balls */}
      {positions.map((pos, i) => (
        <JointBall
          key={`jb-${i}`}
          position={pos}
          radius={(radii[i] || 0.4) * 0.7}
          color={i < joints.length ? (stopped ? '#444' : joints[i].color) : '#4880f0'}
          isNearLimit={i < joints.length ? (
            (joints[i].angle - joints[i].min) / (joints[i].max - joints[i].min) < 0.12 ||
            (joints[i].angle - joints[i].min) / (joints[i].max - joints[i].min) > 0.88
          ) : false}
        />
      ))}

      {/* End effector marker */}
      <mesh position={positions[positions.length - 1]} castShadow>
        <coneGeometry args={[0.4, 1, 8]} />
        <meshStandardMaterial
          color={stopped ? '#999' : '#007aff'}
          emissive={stopped ? '#000' : '#007aff'}
          emissiveIntensity={stopped ? 0 : 0.3}
        />
      </mesh>
    </group>
  )
}
