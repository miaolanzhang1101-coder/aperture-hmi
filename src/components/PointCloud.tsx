import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function rand(lo: number, hi: number) { return lo + Math.random() * (hi - lo) }

interface PointCloudProps {
  visible: boolean
  pointCount?: number
}

export default function PointCloud({ visible, pointCount = 4000 }: PointCloudProps) {
  const geoRef = useRef<THREE.BufferGeometry>(null)

  const { positions, colors, basePositions } = useMemo(() => {
    const pos = new Float32Array(pointCount * 3)
    const col = new Float32Array(pointCount * 3)
    const base = new Float32Array(pointCount * 3)

    for (let i = 0; i < pointCount; i++) {
      // Generate environment scan: ground plane + some vertical surfaces
      const type = Math.random()
      let x: number, y: number, z: number

      if (type < 0.5) {
        // Ground plane scatter
        x = rand(-25, 25); y = rand(-0.5, 0.3); z = rand(-25, 25)
        col[i * 3] = 0.15; col[i * 3 + 1] = 0.35; col[i * 3 + 2] = 0.3
      } else if (type < 0.75) {
        // Obstacle A cluster
        const a = Math.random() * Math.PI * 2
        const r = rand(0, 5)
        x = 10 + Math.cos(a) * r; y = rand(0, 8); z = 8 + Math.sin(a) * r
        col[i * 3] = 0.8; col[i * 3 + 1] = 0.3; col[i * 3 + 2] = 0.2
      } else if (type < 0.9) {
        // Obstacle B cluster
        const a = Math.random() * Math.PI * 2
        const r = rand(0, 4)
        x = -8 + Math.cos(a) * r; y = rand(0, 6); z = 12 + Math.sin(a) * r
        col[i * 3] = 0.9; col[i * 3 + 1] = 0.6; col[i * 3 + 2] = 0.15
      } else {
        // Operator zone scan
        const a = Math.random() * Math.PI * 2
        const r = rand(0, 6)
        x = 6 + Math.cos(a) * r; y = rand(0, 10); z = -10 + Math.sin(a) * r
        col[i * 3] = 0.3; col[i * 3 + 1] = 0.5; col[i * 3 + 2] = 0.9
      }

      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
      base[i * 3] = x; base[i * 3 + 1] = y; base[i * 3 + 2] = z
    }

    return { positions: pos, colors: col, basePositions: base }
  }, [pointCount])

  // Animate subtle sensor noise
  useFrame(({ clock }) => {
    if (!geoRef.current || !visible) return
    const t = clock.elapsedTime
    for (let i = 0; i < pointCount; i++) {
      positions[i * 3] = basePositions[i * 3] + Math.sin(t * 2 + i * 0.1) * 0.03
      positions[i * 3 + 1] = basePositions[i * 3 + 1] + Math.cos(t * 1.5 + i * 0.15) * 0.02
      positions[i * 3 + 2] = basePositions[i * 3 + 2] + Math.sin(t * 1.8 + i * 0.12) * 0.03
    }
    geoRef.current.attributes.position.needsUpdate = true
  })

  if (!visible) return null

  return (
    <points>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.15}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  )
}
