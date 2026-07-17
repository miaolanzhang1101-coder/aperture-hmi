# Aperture HMI — Situational Awareness & Safety UX for Robotics

A single-screen WebGL robot operator interface with Apple Liquid Glass design language. Built with React, TypeScript, Three.js, and React Three Fiber.

## Design Language

Apple Liquid Glass: translucent panels with `backdrop-filter: blur(24px) saturate(1.6)`, white-based glassmorphism, soft shadows, SF-style typography. No gratuitous color — alerts use system red/orange only when they mean something. `prefers-reduced-motion` respected throughout.

## Safety-Critical UX

- **IK Drag Controls** — CCD inverse kinematics solver. Drag the target gizmo in 3D; joints solve in real time with limit enforcement. Gizmo turns red when unreachable.
- **E-Stop** — Two-step: arm → confirm. Keyboard shortcut `Esc`. Visual guard ring. Requires explicit Reset. All controls disabled when stopped.
- **Collision Zones** — Wireframe spheres pulse and fill as joints approach. Arm segments glow red proportional to proximity. Alert cards stack in the left panel.
- **Joint Limit Bars** — Fill bars turn orange → red near mechanical limits. Prevents damage.
- **Point Cloud** — 4k simulated LiDAR points with sensor noise. Toggleable via accessible switch.

## Accessible Drag-to-Load

Drop `.csv`, `.json`, `.pcd`, `.ply`, or `.xyz` files onto the viewport to load sensor data. The drop zone:
- Activates only on dragover (not always visible)
- Shows accepted file types clearly
- Provides a toast confirmation on successful load
- Keyboard alternative: the Data Import panel in the right sidebar
- All interactive elements have `aria-label`, `role`, and `focus-visible` styles

## Quick Start

```bash
npm install
npm run dev
```

## Stack

React 18 · TypeScript · Three.js · @react-three/fiber · @react-three/drei · Vite
