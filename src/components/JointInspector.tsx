import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { type JointDef, getJointLimitRatio, isNearLimit } from '../utils/ik'

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

// ── Simulated per-joint sensor data ──
function getJointSensorData(joint: JointDef, index: number, time: number) {
  const torque = 2.4 + Math.sin(time * 0.7 + index * 1.3) * 1.8
  const temp = 38 + index * 3 + Math.sin(time * 0.3 + index) * 2
  const current = 1.2 + Math.sin(time * 0.5 + index * 0.8) * 0.6
  return { torque: torque.toFixed(1), temp: temp.toFixed(0), current: current.toFixed(1) }
}

// ── Joint range-of-motion arc (3D) ──
// Renders a torus arc showing min→max range with the current angle marked
function JointRangeArc({
  position, joint, visible, opacity
}: {
  position: THREE.Vector3; joint: JointDef; visible: boolean; opacity: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const markerRef = useRef<THREE.Mesh>(null)
  const sweepRef = useRef<THREE.Mesh>(null)

  const arcRadius = 3.2
  const range = joint.max - joint.min
  const ratio = getJointLimitRatio(joint)
  const nearLimit = isNearLimit(joint, 0.12)

  // Create arc geometry for the full range
  const arcPoints = useMemo(() => {
    const segments = 64
    const pts: [number, number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = joint.min + t * range
      pts.push([Math.cos(angle) * arcRadius, 0, Math.sin(angle) * arcRadius])
    }
    return pts
  }, [joint.min, range, arcRadius])

  // Create filled sweep showing current angle
  const sweepGeo = useMemo(() => {
    const segments = 32
    const currentRange = joint.angle - joint.min
    const points: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)]
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = joint.min + t * currentRange
      points.push(new THREE.Vector3(
        Math.cos(angle) * arcRadius,
        0,
        Math.sin(angle) * arcRadius
      ))
    }
    // Build triangle fan
    const indices: number[] = []
    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1)
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points)
    geo.setIndex(indices)
    return geo
  }, [joint.min, joint.angle, arcRadius])

  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.position.copy(position)
    // Align arc to the joint's rotation axis
    if (joint.axis.y === 1) {
      groupRef.current.rotation.set(0, 0, 0)
    } else if (joint.axis.x === 1) {
      groupRef.current.rotation.set(0, 0, Math.PI / 2)
    } else {
      groupRef.current.rotation.set(Math.PI / 2, 0, 0)
    }

    // Animate marker to current angle
    if (markerRef.current) {
      const a = joint.angle
      markerRef.current.position.set(
        Math.cos(a) * arcRadius,
        0,
        Math.sin(a) * arcRadius
      )
    }
  })

  if (!visible) return null

  const arcColor = nearLimit ? '#ff3b30' : '#007aff'

  return (
    <group ref={groupRef}>
      {/* Full range arc (outer track) */}
      <Line
        points={arcPoints}
        color="#007aff"
        transparent
        opacity={opacity * 0.25}
        lineWidth={1}
      />

      {/* Filled sweep (current value) */}
      <mesh geometry={sweepGeo} ref={sweepRef}>
        <meshBasicMaterial
          color={arcColor}
          transparent
          opacity={opacity * 0.06}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Current angle marker */}
      <mesh ref={markerRef}>
        <sphereGeometry args={[0.2, 12, 8]} />
        <meshBasicMaterial color={arcColor} transparent opacity={opacity * 0.9} />
      </mesh>

      {/* Min limit tick */}
      <mesh position={[Math.cos(joint.min) * arcRadius, 0, Math.sin(joint.min) * arcRadius]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color="#ff3b30" transparent opacity={opacity * 0.5} />
      </mesh>

      {/* Max limit tick */}
      <mesh position={[Math.cos(joint.max) * arcRadius, 0, Math.sin(joint.max) * arcRadius]}>
        <sphereGeometry args={[0.12, 8, 6]} />
        <meshBasicMaterial color="#ff3b30" transparent opacity={opacity * 0.5} />
      </mesh>
    </group>
  )
}

// ── Highlight ring around hovered/focused joint ──
function JointHighlight({
  position, radius, active, focused, opacity
}: {
  position: THREE.Vector3; radius: number; active: boolean; focused: boolean; opacity: number
}) {
  const ref = useRef<THREE.Mesh>(null)

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.position.copy(position)
    // Gently pulse when focused
    if (focused) {
      const s = 1 + Math.sin(clock.elapsedTime * 3) * 0.06
      ref.current.scale.setScalar(s)
    } else {
      ref.current.scale.setScalar(1)
    }
  })

  if (!active && !focused) return null

  return (
    <mesh ref={ref}>
      <ringGeometry args={[radius * 1.5, radius * 1.8, 32]} />
      <meshBasicMaterial
        color={focused ? '#007aff' : '#007aff'}
        transparent
        opacity={opacity * (focused ? 0.35 : 0.2)}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// ═══════════════════════════════════
// MAIN INSPECTOR — raycasts, manages hover/focus, renders arcs + highlights
// ═══════════════════════════════════
interface JointInspectorProps {
  joints: JointDef[]
  jointPositions: THREE.Vector3[]
  hoveredJoint: number | null
  focusedJoint: number | null
  onHover: (index: number | null) => void
  onFocus: (index: number | null) => void
  // Tooltip projection callback: sends screen coords + data to DOM
  onTooltipUpdate: (data: {
    visible: boolean
    x: number; y: number
    joint: JointDef | null
    index: number
    sensor: { torque: string; temp: string; current: string }
  }) => void
}

export default function JointInspector({
  joints, jointPositions, hoveredJoint, focusedJoint,
  onHover, onFocus, onTooltipUpdate
}: JointInspectorProps) {
  const { camera, raycaster, gl, size } = useThree()
  const mouse = useMemo(() => new THREE.Vector2(), [])
  const hoveredRef = useRef<number | null>(null)
  const clickedRef = useRef(false)

  // Create invisible hit spheres for raycasting (larger than visual joint balls)
  const hitSpheres = useMemo(() => {
    return jointPositions.map((_, i) => {
      const geo = new THREE.SphereGeometry(([1.5, 1.2, 0.9, 0.7, 0.5, 0.4][i] || 0.4) * 1.4, 8, 6)
      return geo
    })
  }, [jointPositions.length])

  const hitMeshRefs = useRef<(THREE.Mesh | null)[]>([])

  // Update hit sphere positions each frame
  useFrame(({ clock }) => {
    jointPositions.forEach((pos, i) => {
      const mesh = hitMeshRefs.current[i]
      if (mesh) mesh.position.copy(pos)
    })

    // Project hovered joint to screen coords for tooltip
    if (hoveredRef.current !== null && hoveredRef.current < jointPositions.length) {
      const pos = jointPositions[hoveredRef.current]
      const projected = pos.clone().project(camera)
      const x = (projected.x * 0.5 + 0.5) * size.width
      const y = (-projected.y * 0.5 + 0.5) * size.height
      const sensor = getJointSensorData(joints[hoveredRef.current], hoveredRef.current, clock.elapsedTime)
      onTooltipUpdate({
        visible: true,
        x, y,
        joint: joints[hoveredRef.current],
        index: hoveredRef.current,
        sensor
      })
    } else {
      onTooltipUpdate({ visible: false, x: 0, y: 0, joint: null, index: -1, sensor: { torque: '0', temp: '0', current: '0' } })
    }
  })

  // Mouse event handlers
  const handlePointerMove = (e: any) => {
    const intersections = e.intersections as THREE.Intersection[] | undefined
    if (intersections && intersections.length > 0) {
      const idx = intersections[0].object.userData.jointIndex
      if (idx !== undefined && idx !== hoveredRef.current) {
        hoveredRef.current = idx
        onHover(idx)
        gl.domElement.style.cursor = 'pointer'
      }
    }
  }

  const handlePointerOut = () => {
    hoveredRef.current = null
    onHover(null)
    gl.domElement.style.cursor = ''
  }

  const handleClick = (e: any) => {
    const intersections = e.intersections as THREE.Intersection[] | undefined
    if (intersections && intersections.length > 0) {
      const idx = intersections[0].object.userData.jointIndex
      if (idx !== undefined) {
        onFocus(focusedJoint === idx ? null : idx)
        if (e.stopPropagation) e.stopPropagation()
      }
    }
  }

  const radii = [1.5, 1.2, 0.9, 0.7, 0.5, 0.4]

  return (
    <group>
      {/* Invisible hit spheres for raycasting */}
      {jointPositions.slice(0, joints.length).map((_, i) => (
        <mesh
          key={`hit-${i}`}
          ref={el => { hitMeshRefs.current[i] = el }}
          geometry={hitSpheres[i]}
          userData={{ jointIndex: i }}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
          visible={false}
        >
          <meshBasicMaterial visible={false} />
        </mesh>
      ))}

      {/* Highlight rings */}
      {jointPositions.slice(0, joints.length).map((pos, i) => (
        <JointHighlight
          key={`hl-${i}`}
          position={pos}
          radius={radii[i] || 0.4}
          active={hoveredJoint === i}
          focused={focusedJoint === i}
          opacity={1}
        />
      ))}

      {/* Range-of-motion arc for focused joint */}
      {focusedJoint !== null && focusedJoint < joints.length && (
        <JointRangeArc
          position={jointPositions[focusedJoint]}
          joint={joints[focusedJoint]}
          visible={true}
          opacity={1}
        />
      )}
    </group>
  )
}
