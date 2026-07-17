import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import RobotArmMesh from './components/RobotArmMesh'
import PointCloud from './components/PointCloud'
import CollisionZonesViz from './components/CollisionZones'
import IKTarget from './components/IKTarget'
import JointInspector from './components/JointInspector'
import {
  JOINT_DEFS, COLLISION_ZONES,
  forwardKinematics, solveCCD, checkCollisions,
  isNearLimit, getJointLimitRatio,
  type JointDef, type CollisionResult,
} from './utils/ik'

// ── FPS counter ──
function FPSCounter({ domRef }: { domRef: React.RefObject<HTMLSpanElement | null> }) {
  const frames = useRef(0)
  const last = useRef(performance.now())
  useFrame(() => {
    frames.current++
    const now = performance.now()
    if (now - last.current > 500) {
      const fps = Math.round(frames.current / ((now - last.current) / 1000))
      if (domRef.current) domRef.current.textContent = `${fps}`
      frames.current = 0; last.current = now
    }
  })
  return null
}

// ── IK drag handler ──
function IKDragHandler({ enabled, onDrag, target }: {
  enabled: boolean; onDrag: (p: THREE.Vector3) => void; target: THREE.Vector3
}) {
  const { camera, raycaster, gl } = useThree()
  const plane = useMemo(() => new THREE.Plane(), [])
  const dragging = useRef(false)
  const mouse = useMemo(() => new THREE.Vector2(), [])

  useEffect(() => {
    if (!enabled) return
    const el = gl.domElement
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const rect = el.getBoundingClientRect()
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(mouse, camera)
      const tScreen = target.clone().project(camera)
      if (Math.sqrt((mouse.x - tScreen.x) ** 2 + (mouse.y - tScreen.y) ** 2) < 0.15) {
        dragging.current = true
        plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), target)
        el.style.cursor = 'grabbing'
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const rect = el.getBoundingClientRect()
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(mouse, camera)
      const hit = new THREE.Vector3()
      raycaster.ray.intersectPlane(plane, hit)
      if (hit) onDrag(hit)
    }
    const onUp = () => { dragging.current = false; el.style.cursor = '' }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp) }
  }, [enabled, camera, raycaster, gl, mouse, plane, onDrag, target])
  return null
}

// ── Toggle switch ──
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      className="toggle-row"
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      onClick={() => onChange(!on)}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!on) } }}
    >
      <span>{label}</span>
      <div className={`toggle-track ${on ? 'on' : ''}`}>
        <div className="toggle-thumb" />
      </div>
    </div>
  )
}

// ════════════════════════════════
// MAIN APP
// ════════════════════════════════
export default function App() {
  const [joints, setJoints] = useState<JointDef[]>(() => JOINT_DEFS.map(j => ({ ...j })))
  const [mode, setMode] = useState<'manual' | 'ik' | 'auto'>('ik')
  const [stopped, setStopped] = useState(false)
  const [estopArmed, setEstopArmed] = useState(false)
  const [showPointCloud, setShowPointCloud] = useState(true)
  const [showCollisionZones, setShowCollisionZones] = useState(true)
  const [collisions, setCollisions] = useState<CollisionResult[]>([])
  const [ikReachable, setIkReachable] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [dataLoaded, setDataLoaded] = useState<string | null>(null)
  const [hoveredJoint, setHoveredJoint] = useState<number | null>(null)
  const [focusedJoint, setFocusedJoint] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{
    visible: boolean; x: number; y: number
    joint: JointDef | null; index: number
    sensor: { torque: string; temp: string; current: string }
  }>({ visible: false, x: 0, y: 0, joint: null, index: -1, sensor: { torque: '0', temp: '0', current: '0' } })
  const fpsRef = useRef<HTMLSpanElement>(null)
  const autoTimeRef = useRef(0)
  const [ikTarget, setIkTarget] = useState(() => new THREE.Vector3(5, 15, 3))

  const jointPositions = useMemo(() => forwardKinematics(joints), [joints])
  const endEffector = jointPositions[jointPositions.length - 1]

  useEffect(() => {
    const results = checkCollisions(jointPositions, COLLISION_ZONES)
    setCollisions(results)
  }, [jointPositions])

  const maxSeverity = collisions.reduce((max, c) => Math.max(max, c.severity), 0)
  const systemStatus = stopped ? 'stopped' : maxSeverity > 0.7 ? 'collision' : maxSeverity > 0.3 ? 'warning' : 'nominal'

  const handleIKDrag = useCallback((pos: THREE.Vector3) => {
    if (stopped) return
    setIkTarget(pos.clone())
    const result = solveCCD(joints, pos)
    setIkReachable(result.solved)
    setJoints(result.joints)
  }, [joints, stopped])

  useEffect(() => {
    if (mode !== 'auto' || stopped) return
    const interval = setInterval(() => {
      autoTimeRef.current += 0.03
      const t = autoTimeRef.current
      const target = new THREE.Vector3(Math.sin(t * 0.8) * 8, 10 + Math.sin(t * 0.5) * 6, Math.cos(t * 0.6) * 8)
      setIkTarget(target)
      setJoints(prev => { const r = solveCCD(prev, target); setIkReachable(r.solved); return r.joints })
    }, 30)
    return () => clearInterval(interval)
  }, [mode, stopped])

  const adjustJoint = useCallback((index: number, delta: number) => {
    if (stopped) return
    setJoints(prev => {
      const next = prev.map(j => ({ ...j }))
      next[index].angle = Math.max(next[index].min, Math.min(next[index].max, next[index].angle + delta))
      return next
    })
  }, [stopped])

  // ── E-Stop ──
  const handleEstop = useCallback(() => {
    if (!estopArmed) { setEstopArmed(true); return }
    setStopped(true); setEstopArmed(false)
  }, [estopArmed])

  // ── Drag-drop data loading ──
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = Array.from(e.dataTransfer.files).find(f => /\.(csv|json|pcd|ply|xyz)$/i.test(f.name))
    if (file) {
      setDataLoaded(file.name)
      // In production: parse file and update point cloud data
      setTimeout(() => setDataLoaded(null), 3000)
    }
  }, [])

  // Keyboard shortcut for E-Stop (Escape key)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !stopped) {
        setStopped(true); setEstopArmed(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stopped])

  const jointWarnings = joints.filter(j => isNearLimit(j))

  return (
    <div className="hmi" role="application" aria-label="Robot HMI Control Interface">

      {/* ═══ TOP BAR ═══ */}
      <div className="topbar" role="banner">
        <div className="topbar-left">
          <div className="topbar-logo"><span className="dot" /> Aperture HMI</div>
          <span className={`topbar-status ${systemStatus === 'nominal' ? 'ok' : systemStatus === 'warning' ? 'warn' : 'crit'}`}
                role="status" aria-live="polite">
            {stopped ? '■ E-Stopped' : systemStatus === 'nominal' ? '● Nominal' : systemStatus === 'warning' ? '▲ Warning' : '✖ Collision'}
          </span>
        </div>
        <div className="topbar-right" role="radiogroup" aria-label="Control mode">
          {(['manual', 'ik', 'auto'] as const).map(m => (
            <button key={m} className={`mode-btn ${mode === m ? 'active' : ''}`}
              role="radio" aria-checked={mode === m}
              onClick={() => !stopped && setMode(m)}>
              {m === 'ik' ? 'IK Drag' : m === 'manual' ? 'Manual' : 'Auto'}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ LEFT PANEL ═══ */}
      <div className="panel-left" role="complementary" aria-label="Joint state">
        <div className="panel-section">
          <div className="panel-header">Joints <span className="unit">deg</span></div>
          <div className="panel-body">
            {joints.map((j, i) => {
              const ratio = getJointLimitRatio(j)
              const near = isNearLimit(j, 0.12)
              const cls = near ? (ratio < 0.06 || ratio > 0.94 ? 'crit' : 'warn') : 'safe'
              return (
                <div className="joint-row" key={i} aria-label={`${j.name}: ${(j.angle * 180 / Math.PI).toFixed(1)} degrees`}>
                  <div className="joint-dot" style={{ background: j.color, boxShadow: near ? `0 0 6px ${j.color}` : 'none' }} />
                  <div className="joint-name">J{i + 1}</div>
                  <div className="joint-angle">{(j.angle * 180 / Math.PI).toFixed(1)}°</div>
                  <div className="joint-bar-track" role="meter" aria-valuenow={ratio * 100} aria-valuemin={0} aria-valuemax={100}>
                    <div className={`joint-bar-fill ${cls}`} style={{ width: `${ratio * 100}%` }} />
                  </div>
                  {mode === 'manual' && (
                    <>
                      <button className="joint-btn" onClick={() => adjustJoint(i, -0.05)} aria-label={`Decrease ${j.name}`}>−</button>
                      <button className="joint-btn" onClick={() => adjustJoint(i, 0.05)} aria-label={`Increase ${j.name}`}>+</button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {jointWarnings.map((j, i) => (
          <div className="alert-card warn" key={`jw-${i}`} role="alert">
            <span className="alert-icon">▲</span>
            {j.name} near limit
          </div>
        ))}

        {collisions.filter(c => c.severity > 0.3).map((c, i) => (
          <div className={`alert-card ${c.severity > 0.7 ? 'crit' : 'warn'}`} key={`ca-${i}`} role="alert">
            <span className="alert-icon">{c.severity > 0.7 ? '✖' : '▲'}</span>
            J{c.jointIndex + 1} → {COLLISION_ZONES[c.zoneIndex].label}
          </div>
        ))}

        <div className="panel-section">
          <div className="panel-header">Layers</div>
          <div className="panel-body">
            <Toggle on={showPointCloud} onChange={setShowPointCloud} label="Point Cloud" />
            <Toggle on={showCollisionZones} onChange={setShowCollisionZones} label="Collision Zones" />
          </div>
        </div>
      </div>

      {/* ═══ VIEWPORT ═══ */}
      <div className="viewport"
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(false) }}
        onDrop={handleDrop}
      >
        {/* Overlays */}
        <div className="viewport-overlay tl">
          <div className="viewport-badge">FPS <span className="val" ref={fpsRef}>60</span></div>
        </div>
        <div className="viewport-overlay tr">
          <div className="viewport-badge">
            TCP <span className="val">[{endEffector.x.toFixed(1)}, {endEffector.y.toFixed(1)}, {endEffector.z.toFixed(1)}]</span>
          </div>
        </div>
        <div className="viewport-overlay bl">
          <div className="hint-badge">
            {mode === 'ik' && <><span className="hint-key">Drag</span> target gizmo to move end-effector</>}
            {mode === 'manual' && <>Use <span className="hint-key">−</span> <span className="hint-key">+</span> to adjust joints</>}
            {mode === 'auto' && <>Autonomous trajectory</>}
          </div>
        </div>
        <div className="viewport-overlay br">
          <div className="viewport-badge">{showPointCloud ? <>PCD <span className="val">4.0k</span></> : 'PCD off'}</div>
        </div>

        {/* Data loaded toast */}
        {dataLoaded && (
          <div className="viewport-overlay" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
            <div className="viewport-badge" style={{ fontSize: 13, padding: '8px 16px', background: 'rgba(255,255,255,0.85)' }}>
              ✓ Loaded <span className="val">{dataLoaded}</span>
            </div>
          </div>
        )}

        {/* Drag overlay */}
        <div className={`drag-overlay ${dragOver ? 'visible' : ''}`} aria-hidden={!dragOver}>
          <div className="drag-ring"><span className="drag-ring-icon">📄</span></div>
          <div className="drag-label">Drop sensor data</div>
          <div className="drag-sublabel">.csv · .json · .pcd · .ply · .xyz</div>
        </div>

        <Canvas camera={{ position: [25, 20, 30], fov: 45 }} shadows
          style={{ background: 'linear-gradient(180deg, #e8edf8 0%, #d8dff0 50%, #c8d4e8 100%)' }}>
          <ambientLight intensity={0.5} color="#ffffff" />
          <directionalLight position={[20, 30, 15]} intensity={0.9} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
          <directionalLight position={[-15, 10, -10]} intensity={0.3} color="#aabbdd" />
          <pointLight position={[0, 15, 10]} intensity={0.15} color="#007aff" distance={60} />

          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[80, 80]} />
            <meshStandardMaterial color="#d0d8e8" roughness={0.85} metalness={0.05} />
          </mesh>
          <Grid args={[80, 80]} position={[0, 0.01, 0]} cellSize={2} cellThickness={0.4}
            cellColor="#b8c0d0" sectionSize={10} sectionThickness={0.8} sectionColor="#a0a8b8"
            fadeDistance={50} infiniteGrid={false} />
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[19, 19.2, 64]} />
            <meshBasicMaterial color="#007aff" transparent opacity={0.08} side={THREE.DoubleSide} />
          </mesh>

          <OrbitControls target={[0, 10, 0]} minDistance={12} maxDistance={80} enablePan={mode !== 'ik'} />
          <FPSCounter domRef={fpsRef} />
          <RobotArmMesh joints={joints} collisionSeverity={maxSeverity} stopped={stopped} />
          {mode === 'ik' && <IKTarget position={ikTarget} onDrag={handleIKDrag} active reachable={ikReachable} />}
          <IKDragHandler enabled={mode === 'ik' && !stopped} onDrag={handleIKDrag} target={ikTarget} />
          <PointCloud visible={showPointCloud} pointCount={4000} />
          <CollisionZonesViz zones={COLLISION_ZONES} collisions={collisions} visible={showCollisionZones} />
          <JointInspector
            joints={joints}
            jointPositions={jointPositions}
            hoveredJoint={hoveredJoint}
            focusedJoint={focusedJoint}
            onHover={setHoveredJoint}
            onFocus={setFocusedJoint}
            onTooltipUpdate={setTooltip}
          />
          {/* Click background to deselect */}
          <mesh
            position={[0, -1, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            onClick={() => setFocusedJoint(null)}
            visible={false}
          >
            <planeGeometry args={[200, 200]} />
            <meshBasicMaterial visible={false} />
          </mesh>
        </Canvas>

        {/* Hover tooltip — projected from 3D world-space to screen coords */}
        <div
          className={`joint-tooltip ${tooltip.visible && !focusedJoint ? 'visible' : ''}`}
          style={{ left: tooltip.x, top: tooltip.y }}
          role="tooltip"
          aria-hidden={!tooltip.visible}
        >
          {tooltip.joint && (
            <div className="joint-tooltip-card">
              <div className="joint-tooltip-header">
                <div className="joint-tooltip-dot" style={{ background: tooltip.joint.color }} />
                <span className="joint-tooltip-name">{tooltip.joint.name}</span>
                <span className="joint-tooltip-angle">
                  {(tooltip.joint.angle * 180 / Math.PI).toFixed(1)}°
                </span>
              </div>
              <div className="joint-tooltip-row">
                <span className="joint-tooltip-label">Torque</span>
                <span className="joint-tooltip-value">{tooltip.sensor.torque} Nm</span>
              </div>
              <div className="joint-tooltip-row">
                <span className="joint-tooltip-label">Temperature</span>
                <span className="joint-tooltip-value">{tooltip.sensor.temp}°C</span>
              </div>
              <div className="joint-tooltip-row">
                <span className="joint-tooltip-label">Current</span>
                <span className="joint-tooltip-value">{tooltip.sensor.current} A</span>
              </div>
              <div className="joint-tooltip-limit-bar">
                <div className="joint-tooltip-limit-track">
                  <div
                    className="joint-tooltip-limit-fill"
                    style={{
                      width: `${getJointLimitRatio(tooltip.joint) * 100}%`,
                      background: isNearLimit(tooltip.joint) ? 'var(--red)' : 'var(--accent)',
                    }}
                  />
                </div>
                <div className="joint-tooltip-limit-labels">
                  <span>{(tooltip.joint.min * 180 / Math.PI).toFixed(0)}°</span>
                  <span>Range</span>
                  <span>{(tooltip.joint.max * 180 / Math.PI).toFixed(0)}°</span>
                </div>
              </div>
              <div className="joint-tooltip-hint">Click to focus · see range arc</div>
            </div>
          )}
        </div>

        {/* Focused joint info badge */}
        {focusedJoint !== null && focusedJoint < joints.length && (
          <div className="viewport-overlay" style={{ top: 12, left: '50%', transform: 'translateX(-50%)' }}>
            <div className="viewport-badge" style={{ gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: joints[focusedJoint].color, display: 'inline-block' }} />
              {joints[focusedJoint].name}
              <span className="val">{(joints[focusedJoint].angle * 180 / Math.PI).toFixed(1)}°</span>
              <span style={{ color: 'var(--text-tertiary)', cursor: 'pointer', pointerEvents: 'auto' }}
                onClick={() => setFocusedJoint(null)}>✕</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div className="panel-right" role="complementary" aria-label="Sensor data">
        <div className="panel-section">
          <div className="panel-header">End Effector</div>
          <div className="panel-body">
            {['X', 'Y', 'Z'].map((axis, i) => (
              <div className="sensor-row" key={axis}>
                <span className="sensor-label">Position {axis}</span>
                <span className="sensor-value">{[endEffector.x, endEffector.y, endEffector.z][i].toFixed(2)}</span>
              </div>
            ))}
            <div className="sensor-row">
              <span className="sensor-label">IK Status</span>
              <span className={`sensor-value ${ikReachable ? 'ok' : 'crit'}`}>
                {ikReachable ? 'Reachable' : 'Unreachable'}
              </span>
            </div>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-header">Sensors</div>
          <div className="panel-body">
            <div className="sensor-row"><span className="sensor-label">Force</span><span className="sensor-value">12.4 N</span></div>
            <div className="sensor-row"><span className="sensor-label">Torque</span><span className="sensor-value">3.2 Nm</span></div>
            <div className="sensor-row">
              <span className="sensor-label">Motor Temp</span>
              <span className={`sensor-value ${jointWarnings.length > 0 ? 'warn' : ''}`}>42°C</span>
            </div>
            <div className="sensor-row"><span className="sensor-label">Cycle Time</span><span className="sensor-value">1.24s</span></div>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-header">Collision Zones</div>
          <div className="panel-body">
            {COLLISION_ZONES.map((z, i) => {
              const zc = collisions.filter(c => c.zoneIndex === i)
              const severity = zc.reduce((max, c) => Math.max(max, c.severity), 0)
              return (
                <div className="sensor-row" key={i}>
                  <span className="sensor-label">{z.label}</span>
                  <span className={`sensor-value ${severity > 0.7 ? 'crit' : severity > 0.3 ? 'warn' : 'ok'}`}>
                    {zc.length > 0 ? `${(severity * 100).toFixed(0)}%` : 'Clear'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-header">Coord. Alignment</div>
          <div className="panel-body">
            <div className="sensor-row"><span className="sensor-label">Cam ↔ 3D</span><span className="sensor-value ok">Aligned</span></div>
            <div className="sensor-row"><span className="sensor-label">Space</span><span className="sensor-value">World</span></div>
            <div className="sensor-row"><span className="sensor-label">Depth</span><span className="sensor-value">0.1–80m</span></div>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-header">Data Import</div>
          <div className="panel-body">
            <div className="hint-badge" style={{ justifyContent: 'center', padding: '8px 0' }}>
              Drag <span className="hint-key">.csv</span> <span className="hint-key">.json</span> <span className="hint-key">.pcd</span> onto viewport
            </div>
          </div>
        </div>
      </div>

      {/* ═══ BOTTOM BAR ═══ */}
      <div className="bottombar" role="contentinfo">
        <div className="telemetry-strip">
          <div className="telemetry-item">Mode <span className="val">{mode.toUpperCase()}</span></div>
          <div className="telemetry-item">Joints <span className={`val ${jointWarnings.length > 0 ? 'warn' : 'ok'}`}>
            {jointWarnings.length > 0 ? `${jointWarnings.length} limit` : 'OK'}
          </span></div>
          <div className="telemetry-item">Collisions <span className={`val ${collisions.length > 0 ? 'warn' : 'ok'}`}>
            {collisions.length > 0 ? collisions.length : 'Clear'}
          </span></div>
          <div className="telemetry-item">
            <span className="hint-key" style={{ fontSize: 8 }}>Esc</span> E-Stop
          </div>
        </div>

        {stopped && <button className="reset-btn" onClick={() => { setStopped(false); setEstopArmed(false) }}>Reset</button>}

        <div className="estop-wrap">
          <span className="estop-label">{estopArmed ? 'Confirm' : 'E-Stop'}</span>
          <button
            className={`estop-btn ${estopArmed ? 'armed' : ''} ${stopped ? 'triggered' : ''}`}
            onClick={handleEstop} disabled={stopped}
            aria-label={stopped ? 'Emergency stop triggered' : estopArmed ? 'Confirm emergency stop' : 'Arm emergency stop'}
          >
            {stopped ? '■' : '⏻'}
            <span className="estop-guard" />
          </button>
        </div>
      </div>
    </div>
  )
}
