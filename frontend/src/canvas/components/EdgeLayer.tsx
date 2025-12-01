import { memo, useMemo, useState } from "react"

import {
  CANVAS_NODE_HEIGHT,
  CANVAS_NODE_WIDTH,
  CANVAS_WORLD_HALF_EXTENT,
} from "@/canvas/constants"
import CanvasEdgePath from "@/canvas/components/CanvasEdgePath"
import useCanvasStore, { type CanvasNode, type CanvasNodeVariant } from "@/canvas/store"

const PORT_CENTER_OFFSET = 4

const EDGE_ACCENTS: Record<CanvasNodeVariant, string> = {
  channel: "rgba(250,204,21,0.9)",
  agent: "rgba(147,197,253,0.95)",
  tool: "rgba(253,230,138,0.9)",
  knowledge: "rgba(251,146,60,0.9)",
  skill: "rgba(244,114,182,0.9)",
}

const getPorts = (node: CanvasNode) => {
  const width = CANVAS_NODE_WIDTH
  const height = CANVAS_NODE_HEIGHT
  const centerY = node.y + height / 2

  return {
    out: { x: node.x + width + PORT_CENTER_OFFSET, y: centerY },
    in: { x: node.x - PORT_CENTER_OFFSET, y: centerY },
  }
}

const buildCurve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.abs(b.x - a.x)
  const lift = Math.max(60, dx * 0.2)
  const c1 = { x: a.x + lift, y: a.y }
  const c2 = { x: b.x - lift, y: b.y }

  return {
    path: `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`,
    c1,
    c2,
  }
}

const cubicPoint = (
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number,
) => {
  const mt = 1 - t
  const x =
    mt * mt * mt * p0.x +
    3 * mt * mt * t * p1.x +
    3 * mt * t * t * p2.x +
    t * t * t * p3.x
  const y =
    mt * mt * mt * p0.y +
    3 * mt * mt * t * p1.y +
    3 * mt * t * t * p2.y +
    t * t * t * p3.y
  return { x, y }
}

const EdgeLayerComponent = () => {
  const nodes = useCanvasStore((state) => state.nodes)
  const edges = useCanvasStore((state) => state.edges)
  const connectingFrom = useCanvasStore((state) => state.connectingFrom)
  const removeEdge = useCanvasStore((state) => state.removeEdge)
  const viewport = useCanvasStore((state) => state.viewport)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const clientToWorld = (clientX: number, clientY: number) => {
    const root = document.querySelector("[data-canvas-root]") as HTMLElement | null
    if (!root) return { x: clientX, y: clientY }
    const rect = root.getBoundingClientRect()
    return {
      x: (clientX - rect.left - viewport.tx) / viewport.scale,
      y: (clientY - rect.top - viewport.ty) / viewport.scale,
    }
  }

  const getPathHandlePoint = (handleId: string | undefined) => {
    if (!handleId) return null
    const el = document.querySelector(`[data-path-handle="${handleId}"]`) as HTMLElement | null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  // ✅ NEW HELPER FOR DYNAMIC PORT POSITIONS
  const getPortPoint = (nodeId: string, port: "in" | "out") => {
    const el = document.querySelector(`button[data-node-id="${nodeId}"][data-port="${port}"]`) as HTMLElement | null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const nodesById = useMemo(() => {
    return new Map(nodes.map((node) => [node.id, node]))
  }, [nodes])

  const size = CANVAS_WORLD_HALF_EXTENT

  return (
    <svg
      aria-hidden
      width={size * 2}
      height={size * 2}
      viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}
      style={{
        position: "absolute",
        left: -size,
        top: -size,
        pointerEvents: "none",
        overflow: "visible",
        zIndex: 5,
      }}
    >
      <defs>
        <marker
          id="workflowEdgeArrow"
          markerWidth="14"
          markerHeight="14"
          refX="10"
          refY="7"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 14 7 L 0 14 z" fill="rgba(209,213,219,0.9)" />
        </marker>
      </defs>

      {edges.map((edge) => {
        const sourceNode = nodesById.get(edge.source)
        const targetNode = nodesById.get(edge.target)
        if (!sourceNode || !targetNode) return null

        // ✅ EXACT START FROM REAL HANDLE OR DYNAMIC PORT
        const pathStart = getPathHandlePoint(edge.sourceHandle)
        const start = pathStart ?? getPortPoint(sourceNode.id, "out") ?? getPorts(sourceNode).out

        // ✅ ALWAYS USE DYNAMIC PORT POSITION SO WIRE MOVES WITH NODE
        const end = getPortPoint(targetNode.id, "in") ?? getPorts(targetNode).in

        const { path, c1, c2 } = buildCurve(start, end)
        const mid = cubicPoint(start, c1, c2, end, 0.5)

        const highlighted = hoveredId === edge.id
        const accent =
          sourceNode.accentColor ||
          EDGE_ACCENTS[sourceNode.variant] ||
          "rgba(226,232,240,0.85)"

        return (
          <g
            key={edge.id}
            onMouseEnter={() => setHoveredId(edge.id)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ pointerEvents: "stroke" }}
          >
            <CanvasEdgePath path={path} highlighted={highlighted} accent={accent} />

            {highlighted && (
              <g
                transform={`translate(${mid.x}, ${mid.y})`}
                style={{ pointerEvents: "auto", cursor: "pointer" }}
                onClick={(event) => {
                  event.stopPropagation()
                  removeEdge(edge.id)
                }}
              >
                <circle
                  r={12}
                  fill="rgba(15,15,15,0.9)"
                  stroke="rgba(255,255,255,0.8)"
                  strokeWidth={1.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill="rgba(255,255,255,0.9)"
                  style={{ fontFamily: "Inter, system-ui, sans-serif" }}
                >
                  ×
                </text>
              </g>
            )}
          </g>
        )
      })}

      {/* ✅ CONNECT PREVIEW */}
      {connectingFrom &&
        (() => {
          const sourceNode = nodesById.get(connectingFrom.nodeId)
          if (!sourceNode) return null

          const pathStart = getPathHandlePoint(connectingFrom.pathId)
          const start = pathStart ?? getPorts(sourceNode).out
          const end = { x: connectingFrom.cursorX, y: connectingFrom.cursorY }

          const { path } = buildCurve(start, end)
          const accent =
            sourceNode.accentColor ||
            EDGE_ACCENTS[sourceNode.variant] ||
            "rgba(226,232,240,0.85)"

          return (
            <g style={{ pointerEvents: "none" }}>
              <path
                d={path}
                fill="none"
                stroke={accent}
                strokeWidth={2.2}
                strokeDasharray="6 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )
        })()}
    </svg>
  )
}

export const EdgeLayer = memo(EdgeLayerComponent)
export default EdgeLayer
