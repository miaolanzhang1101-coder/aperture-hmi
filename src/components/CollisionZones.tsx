import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { type CollisionZone, type CollisionResult } from '../utils/ik'

interface CollisionZonesProps {
  zones: CollisionZone[]
  collisions: CollisionResult[]
  visible: boolean
}

const ZONE_COLORS: Record<string, string> = {
  obstacle: '#ff3b30',
  restricted: '#ff9500',
  human: '#007aff',
}

function Zone({
  zone, isColliding, severity, visible
}: {
  zone: CollisionZone; isColliding: boolean; severity: number; visible: boolean
}) {
  const shellRef = useRef<THREE.Mesh>(null)
  const innerRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!shellRef.current) return
    const t = clock.elapsedTime
    const pulse = isColliding ? 0.3 + Math.sin(t * 6) * 0.15 : 0.06
    const mat = shellRef.current.material as THREE.MeshBasicMaterial
    mat.opacity = visible ? pulse : 0

    if (innerRef.current) {
      const imat = innerRef.current.material as THREE.MeshBasicMaterial
      imat.opacity = visible && isColliding ? severity * 0.2 : 0
    }

    if (ringRef.current) {
      ringRef.current.rotation.y = t * 0.5
      ringRef.current.rotation.x = Math.sin(t * 0.3) * 0.1
    }
  })

  const color = ZONE_COLORS[zone.type] || '#f06070'

  return (
    <group position={zone.center}>
      {/* Outer wireframe shell */}
      <mesh ref={shellRef}>
        <sphereGeometry args={[zone.radius, 24, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.06}
          wireframe
          depthWrite={false}
        />
      </mesh>

      {/* Inner solid fill when colliding */}
      <mesh ref={innerRef}>
        <sphereGeometry args={[zone.radius * 0.95, 16, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Rotating ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[zone.radius - 0.1, zone.radius + 0.1, 64]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={visible ? 0.08 : 0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Label sprite would go here in production */}
    </group>
  )
}

export default function CollisionZones({ zones, collisions, visible }: CollisionZonesProps) {
  return (
    <>
      {zones.map((zone, i) => {
        const zoneCollisions = collisions.filter((c) => c.zoneIndex === i)
        const maxSeverity = zoneCollisions.reduce((max, c) => Math.max(max, c.severity), 0)
        return (
          <Zone
            key={i}
            zone={zone}
            isColliding={zoneCollisions.length > 0}
            severity={maxSeverity}
            visible={visible}
          />
        )
      })}
    </>
  )
}
