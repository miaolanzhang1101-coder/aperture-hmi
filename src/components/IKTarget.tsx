import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'

interface IKTargetProps {
  position: THREE.Vector3
  onDrag: (pos: THREE.Vector3) => void
  active: boolean
  reachable: boolean
}

export default function IKTarget({ position, onDrag, active, reachable }: IKTargetProps) {
  const groupRef = useRef<THREE.Group>(null)
  const ring1Ref = useRef<THREE.Mesh>(null)
  const ring2Ref = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    groupRef.current.position.copy(position)

    const t = clock.elapsedTime
    if (ring1Ref.current) ring1Ref.current.rotation.y = t * 1.5
    if (ring2Ref.current) ring2Ref.current.rotation.x = t * 1.2
  })

  const color = !reachable ? '#ff3b30' : active ? '#007aff' : '#5856d6'
  const opacity = active ? 0.45 : 0.2

  return (
    <group ref={groupRef}>
      {/* Center sphere */}
      <mesh>
        <sphereGeometry args={[0.4, 12, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>

      {/* Orbiting rings */}
      <mesh ref={ring1Ref}>
        <ringGeometry args={[1.0, 1.15, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh ref={ring2Ref}>
        <ringGeometry args={[0.7, 0.82, 32]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Axis lines */}
      {[[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((axis, i) => {
        const colors = ['#ff3b30', '#30d158', '#007aff']
        const pts: [number, number, number][] = [
          [-axis[0] * 1.5, -axis[1] * 1.5, -axis[2] * 1.5],
          [axis[0] * 1.5, axis[1] * 1.5, axis[2] * 1.5],
        ]
        return (
          <Line key={i} points={pts} color={colors[i]} transparent opacity={0.3} lineWidth={1} />
        )
      })}
    </group>
  )
}
