import React, { memo, useCallback } from "react"
import { Plus } from "lucide-react"

import { CANVAS_NODE_HEIGHT, CANVAS_NODE_RADIUS, CANVAS_NODE_WIDTH } from "@/canvas/constants"
import CanvasNodeCard from "@/canvas/components/CanvasNodeCard"
import useCanvasStore, { type CanvasNode } from "@/canvas/store"

const NodeLayerComponent = () => {
  const nodes = useCanvasStore((state) => state.nodes)
  const quickAddNodeId = useCanvasStore((state) => state.quickAddNodeId)
  const setQuickAddNodeId = useCanvasStore((state) => state.setQuickAddNodeId)

  // ✅ Close Quick Add Menu when clicking outside
  React.useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (!quickAddNodeId) return
      const target = event.target as HTMLElement
      if (!target.closest('[data-quick-add-menu]') && !target.closest('[data-quick-add-trigger]')) {
        setQuickAddNodeId(null)
      }
    }
    window.addEventListener("mousedown", handleGlobalClick)
    return () => window.removeEventListener("mousedown", handleGlobalClick)
  }, [quickAddNodeId, setQuickAddNodeId])

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {nodes.map((node) => (
        <NodeItem key={node.id} node={node} />
      ))}
    </div>
  )
}

const NodeItem = memo(({ node }: { node: CanvasNode }) => {
  const focusedNodeId = useCanvasStore((state) => state.focusedNodeId)
  const setFocusedNode = useCanvasStore((state) => state.setFocusedNode)
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds)
  const toggleNodeSelection = useCanvasStore((state) => state.toggleNodeSelection)
  const connectingFrom = useCanvasStore((state) => state.connectingFrom)
  const startConnection = useCanvasStore((state) => state.startConnection)
  const updateConnectionPointer = useCanvasStore((state) => state.updateConnectionPointer)
  const endConnection = useCanvasStore((state) => state.endConnection)
  const setHoveredHandle = useCanvasStore((state) => state.setHoveredHandle)
  const addPathToNode = useCanvasStore((state) => state.addPathToNode)
  const openPathDialog = useCanvasStore((state) => state.openPathDialog)
  const removePathFromNode = useCanvasStore((state) => state.removePathFromNode)

  // ✅ WORLD CONVERSION (CORRECT)
  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const canvasRoot = document.querySelector("[data-canvas-root]") as HTMLElement | null
    if (!canvasRoot) return { x: clientX, y: clientY }
    const rect = canvasRoot.getBoundingClientRect()
    const { tx, ty, scale } = useCanvasStore.getState().viewport
    return {
      x: (clientX - rect.left - tx) / scale,
      y: (clientY - rect.top - ty) / scale,
    }
  }, [])

  const handleConnectionStart = useCallback(
    (event: PointerEvent, originX: number, originY: number, pathId?: string) => {
      event.preventDefault()
      event.stopPropagation()
      startConnection(node.id, originX, originY, pathId)

      const targetEl = event.target as HTMLElement | null
      try {
        targetEl?.setPointerCapture?.(event.pointerId)
      } catch { }

      const onMove = (ev: PointerEvent) => {
        const worldPoint = clientToWorld(ev.clientX, ev.clientY)
        updateConnectionPointer(worldPoint.x, worldPoint.y)
      }

      const onUp = (ev: PointerEvent) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
        let inputHandle = under?.closest?.('[data-port="in"]') as HTMLElement | null
        let targetNodeId = inputHandle?.getAttribute("data-node-id") || null

        // ✅ IMPROVEMENT: If not dropped on handle, check if dropped on node body
        if (!targetNodeId) {
          const nodeBody = under?.closest?.("[data-node-id]") as HTMLElement | null
          if (nodeBody) {
            targetNodeId = nodeBody.getAttribute("data-node-id")
            // Find the input handle for this node to get correct coordinates
            inputHandle = nodeBody.querySelector('[data-port="in"]') as HTMLElement | null
          }
        }

        // Don't connect to self
        if (targetNodeId === node.id) {
          targetNodeId = null
        }

        let endPoint = null
        if (targetNodeId && inputHandle) {
          const rect = inputHandle.getBoundingClientRect()
          endPoint = clientToWorld(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          )
        }

        endConnection(targetNodeId, endPoint)
        try {
          targetEl?.releasePointerCapture?.(ev.pointerId)
        } catch { }

        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
        setHoveredHandle(null)
      }

      window.addEventListener("pointermove", onMove, { passive: true })
      window.addEventListener("pointerup", onUp, { once: true })
      window.addEventListener("pointercancel", onUp, { once: true })
    },
    [clientToWorld, endConnection, node.id, setHoveredHandle, startConnection, updateConnectionPointer],
  )

  const handleBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const related = event.relatedTarget as HTMLElement | null
      if (related && event.currentTarget.contains(related)) return
      if (useCanvasStore.getState().focusedNodeId === node.id) {
        setFocusedNode(null)
      }
    },
    [node.id, setFocusedNode],
  )

  const selected = selectedNodeIds.includes(node.id)
  const accent = node.accentColor || "rgba(148,163,184,0.8)"

  return (
    <div
      data-node-id={node.id}
      tabIndex={0}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: CANVAS_NODE_WIDTH,
        pointerEvents: "auto",
        outline: "none",
        borderRadius: CANVAS_NODE_RADIUS,
        isolation: "isolate",
      }}
      onFocus={() => setFocusedNode(node.id)}
      onBlur={handleBlur}
      onClick={(event) => {
        const multi = event.metaKey || event.ctrlKey
        toggleNodeSelection(node.id, multi)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        useCanvasStore.getState().setEditingNodeId(node.id)
      }}
    >
      <div className="relative rounded-xl">
        <CanvasNodeCard
          node={node}
          focused={focusedNodeId === node.id}
          selected={selected}
          onAddCard={() => {
            if (node.variant === "agent") {
              // Agent uses the specific path handler now, but keep this as fallback or for other logic if needed
            } else {
              openPathDialog(node.id, node.variant)
            }
          }}
          onAddSpecificPath={(type) => {
            const defaults = {
              knowledge: { label: "Knowledge", icon: "book", tone: "info" as const },
              skill: { label: "Skills", icon: "zap", tone: "info" as const },
              tool: { label: "Tools", icon: "tool", tone: "info" as const },
            }
            const config = defaults[type as keyof typeof defaults]

            if (config) {
              const store = useCanvasStore.getState()
              const pathId = `path-${Date.now()}`

              // 1. Add the path to the Agent node
              store.addCustomPathToNode(node.id, {
                ...config,
                id: pathId,
                type: type,
                description: `Connect ${config.label.toLowerCase()}.`
              })

              // 2. Create the new node
              const newNodeId = `node-${Date.now()}`
              const offsetIndex = (node.paths?.length || 0)
              const newNodeX = node.x + CANVAS_NODE_WIDTH + 100 // 100px gap
              const newNodeY = node.y + (offsetIndex * 120) // Staggered Y

              store.addNode({
                id: newNodeId,
                x: newNodeX,
                y: newNodeY,
                nodeId: `${type}-${newNodeId.slice(-4)}`,
                integrationId: type,
                name: config.label, // e.g. "Knowledge"
                type: "action",
                shape: "square",
                variant: type,
                badge: type.toUpperCase(),
                subtitle: type === "knowledge" ? "Source" : type === "skill" ? "Capability" : "Automation",
                description: type === "knowledge" ? "Provide context from documents." : type === "skill" ? "Specific ability." : "Trigger an automation.",
                meta: { createdAt: Date.now() },
                accentColor: type === "knowledge" ? "rgba(251,146,60,1)" : type === "skill" ? "rgba(244,114,182,1)" : "rgba(196,181,253,1)",
              })

              // 3. Connect them
              // We need to wait a tick for the node to be added to state? 
              // Zustand is synchronous usually, so this should work immediately.
              store.addEdge({
                id: `e-${node.id}-${newNodeId}-${Date.now()}`,
                source: node.id,
                target: newNodeId,
                sourceHandle: pathId,
                // We don't have exact endX/Y yet because the node isn't rendered, 
                // but the edge layer will calculate it dynamically if we leave it undefined or update it later.
                // However, our store requires endX/endY for the "perfect snap". 
                // Let's calculate the theoretical input port position of the new node.
                endX: newNodeX, // Left edge
                endY: newNodeY + (CANVAS_NODE_HEIGHT / 2) - 30, // Approx center? 
                // Actually, let's let the edge layer handle dynamic updates. 
                // If we pass undefined, it might default to 0,0. 
                // Let's pass the center of the new node's left edge.
                // Input port is at -14px left, top 50%.
                // Node height is dynamic, but let's assume standard height or calc it.
                // Better: Just let it be dynamic. The EdgeLayer handles missing endX/Y by looking up the port.
              })
            }
          }}
          onPathPointerDown={(pathId, event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const worldPoint = clientToWorld(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2,
            )
            handleConnectionStart(event.nativeEvent, worldPoint.x, worldPoint.y, pathId)
          }}
          onRemovePath={(pathId) => removePathFromNode(node.id, pathId)}
        />

        {/* ✅ INPUT PORT — NOW PASSES EXACT WORLD POSITION */}
        {node.type === "action" && (
          <button
            data-port="in"
            data-node-id={node.id}
            className={`absolute -left-[14px] top-1/2 z-[2] flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full ${node.variant === "knowledge" || node.variant === "skill" || node.variant === "tool"
              ? "pointer-events-none opacity-0" // Hide and disable for leaf nodes
              : ""
              }`}
            onPointerUp={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (!connectingFrom) return

              const rect = e.currentTarget.getBoundingClientRect()
              const world = clientToWorld(
                rect.left + rect.width / 2,
                rect.top + rect.height / 2,
              )
              endConnection(node.id, world)
            }}
            onPointerEnter={() => connectingFrom && setHoveredHandle({ nodeId: node.id, port: "in" })}
            onPointerLeave={() => setHoveredHandle(null)}
          >
            <span className="block h-2 w-2 rounded-full bg-white/60" />
          </button>
        )}

        {/* ✅ OUTPUT PORT — HIDE FOR AGENT & SUB-NODES (Knowledge, Skill, Tool) */}
        {node.variant !== "agent" && node.variant !== "knowledge" && node.variant !== "skill" && node.variant !== "tool" && (
          <OutputPort
            node={node}
            clientToWorld={clientToWorld}
            handleConnectionStart={handleConnectionStart}
          />
        )}
      </div>
    </div>
  )
})

const OutputPort = memo(({
  node,
  clientToWorld,
  handleConnectionStart
}: {
  node: CanvasNode
  clientToWorld: (x: number, y: number) => { x: number, y: number }
  handleConnectionStart: (e: PointerEvent, x: number, y: number) => void
}) => {
  const quickAddNodeId = useCanvasStore((state) => state.quickAddNodeId)
  const setQuickAddNodeId = useCanvasStore((state) => state.setQuickAddNodeId)
  const startPosRef = React.useRef<{ x: number, y: number } | null>(null)

  const addNode = (variant: "channel" | "agent" | "tool" | "knowledge" | "skill", name: string, subtitle: string, description: string, badge: string, integrationId: string) => {
    const store = useCanvasStore.getState()
    const newNodeId = `node-${Date.now()}`
    const newNodeX = node.x + CANVAS_NODE_WIDTH + 100
    const newNodeY = node.y

    store.addNode({
      id: newNodeId,
      x: newNodeX,
      y: newNodeY,
      nodeId: `${variant}-${newNodeId.slice(-4)}`,
      integrationId: integrationId,
      name: name,
      type: "action",
      shape: "square",
      variant: variant,
      badge: badge,
      subtitle: subtitle,
      description: description,
      meta: { createdAt: Date.now() },
      accentColor: variant === "knowledge" ? "rgba(251,146,60,1)" : variant === "skill" ? "rgba(244,114,182,1)" : variant === "tool" ? "rgba(196,181,253,1)" : variant === "agent" ? "rgba(16,185,129,1)" : "rgba(125,211,252,1)",
    })
    store.addEdge({
      id: `e-${node.id}-${newNodeId}-${Date.now()}`,
      source: node.id,
      target: newNodeId,
      endX: newNodeX,
      endY: newNodeY + (CANVAS_NODE_HEIGHT / 2),
    })
    store.setQuickAddNodeId(null)
  }

  return (
    <>
      <button
        data-port="out"
        data-node-id={node.id}
        data-quick-add-trigger
        className="absolute -right-[14px] top-1/2 z-[2] flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white shadow-sm transition hover:scale-110 hover:border-neutral-300 active:scale-95"
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          startPosRef.current = { x: e.clientX, y: e.clientY }

          const rect = e.currentTarget.getBoundingClientRect()
          const world = clientToWorld(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          )
          handleConnectionStart(e.nativeEvent, world.x, world.y)
        }}
        onClick={(e) => {
          e.stopPropagation()
          // ✅ Fix: Check if it was a drag or a click
          if (startPosRef.current) {
            const dist = Math.hypot(e.clientX - startPosRef.current.x, e.clientY - startPosRef.current.y)
            if (dist > 5) return // It was a drag, ignore click
          }

          const store = useCanvasStore.getState()
          if (store.quickAddNodeId === node.id) {
            store.setQuickAddNodeId(null)
          } else {
            store.setQuickAddNodeId(node.id)
          }
        }}
      >
        <Plus className="h-4 w-4 text-neutral-900" />
      </button>

      {/* ✅ QUICK ADD MENU */}
      {quickAddNodeId === node.id && (
        <div
          data-quick-add-menu
          className="absolute left-full top-0 z-50 ml-4 w-64 origin-top-left rounded-xl border border-white/10 bg-[#1e1e1e] p-2 shadow-2xl text-white"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              onClick={() => addNode("channel", "Standard Node", "Standard Node", "A standard action node.", "NODE", "custom")}
            >
              Standard Node
            </button>
            <button
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10"
              onClick={() => addNode("agent", "AI Agent", "AI Agent", "AI-driven autonomous node.", "AGENT", "agent")}
            >
              AI Agent
            </button>
          </div>
        </div>
      )}
    </>
  )
})

export const NodeLayer = memo(NodeLayerComponent)
export default NodeLayer
