import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import { CANVAS_GRID_SIZE, CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from "@/canvas/constants"
import useCanvasStore, { type CanvasNodeVariant } from "@/canvas/store"

const NODE_SELECTOR = "[data-node-id]"
const MENU_SELECTOR = "[data-canvas-context-menu]"

const CONTEXT_MENU_VARIANTS: { variant: CanvasNodeVariant; label: string; description: string }[] = [
  {
    variant: "channel",
    label: "Channel",
    description: "Capture conversations from chat, email, or voice.",
  },
  {
    variant: "agent",
    label: "AI Agent",
    description: "Plan, reason, and branch with AI-generated responses.",
  },
  {
    variant: "tool",
    label: "Tool",
    description: "Call APIs, automations, or custom functions.",
  },
  {
    variant: "knowledge",
    label: "Knowledge",
    description: "Connect data sources and documents.",
  },
  {
    variant: "skill",
    label: "Skill",
    description: "Add specialized capabilities to the agent.",
  },
]

const VARIANT_ACCENTS: Record<CanvasNodeVariant, string> = {
  channel: "rgba(125,211,252,1)",
  agent: "rgba(16,185,129,1)",
  tool: "rgba(196,181,253,1)",
  knowledge: "rgba(251,146,60,1)", // Orange
  skill: "rgba(244,114,182,1)",   // Pink
}

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `node-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const snap = (value: number) => Math.round(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE

const InteractionLayerComponent = () => {
  const layerRef = useRef<HTMLDivElement>(null)
  const setLastPointer = useCanvasStore((state) => state.setLastPointer)
  const setKeyState = useCanvasStore((state) => state.setKeyState)
  const setSelectionBox = useCanvasStore((state) => state.setSelectionBox)
  const selectInBox = useCanvasStore((state) => state.selectInBox)
  const clearSelection = useCanvasStore((state) => state.clearSelection)
  const addNode = useCanvasStore((state) => state.addNode)
  const panRef = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null)
  const selectionRef = useRef<{ startX: number; startY: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    type: "canvas" | "node"
    nodeId?: string
    screenX: number
    screenY: number
    worldX: number
    worldY: number
  } | null>(null)

  const toWorld = (event: MouseEvent) => {
    const element = layerRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const viewport = useCanvasStore.getState().viewport
    const x = (event.clientX - rect.left - viewport.tx) / viewport.scale
    const y = (event.clientY - rect.top - viewport.ty) / viewport.scale
    return { x, y }
  }

  const createNodeAt = useCallback(
    (variant: CanvasNodeVariant, worldX: number, worldY: number) => {
      const id = generateId()
      const subtitle: Record<CanvasNodeVariant, string> = {
        channel: "Omnichannel",
        agent: "Reasoning",
        tool: "Automation",
        knowledge: "Source",
        skill: "Capability",
      }
      const descriptions: Record<CanvasNodeVariant, string> = {
        channel: "Entry point that captures a user's request from any channel.",
        agent: "Let the agent reason with context, craft replies, and branch flows.",
        tool: "Trigger an automation, webhook, or scripted capability.",
        knowledge: "Provide context from documents or databases.",
        skill: "Specific ability the agent can perform.",
      }
      const prompt =
        variant === "agent"
          ? "You are an orchestrator. Understand the customer's ask, call the right tools, and craft a helpful response."
          : undefined

      // ✅ REVERTED: No fixed paths, start empty
      const basePaths: any[] = []

      addNode({
        id,
        x: snap(worldX - CANVAS_NODE_WIDTH / 2),
        y: snap(worldY - CANVAS_NODE_HEIGHT / 2),
        nodeId: `${variant}-${id.slice(0, 6)}`,
        integrationId: variant,
        name: variant.charAt(0).toUpperCase() + variant.slice(1),
        type: variant === "channel" ? "trigger" : "action",
        shape: "square",
        variant,
        badge: subtitle[variant],
        subtitle: subtitle[variant],
        description: descriptions[variant],
        prompt,
        paths: basePaths,
        meta: { createdAt: Date.now() },
        accentColor: VARIANT_ACCENTS[variant],
      })
    },
    [addNode],
  )

  const handleMenuSelect = useCallback(
    (variant: CanvasNodeVariant) => {
      if (!contextMenu) return
      createNodeAt(variant, contextMenu.worldX, contextMenu.worldY)
      setContextMenu(null)
    },
    [contextMenu, createNodeAt],
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const store = useCanvasStore.getState()

      if (store.connectingFrom) {
        const world = toWorld(event)
        if (world) {
          store.updateConnectionPointer(world.x, world.y)
        }
      }

      if (panRef.current) {
        const panState = panRef.current
        const dx = event.clientX - panState.startX
        const dy = event.clientY - panState.startY
        const viewport = store.viewport
        store.setViewport({
          ...viewport,
          tx: panState.tx + dx,
          ty: panState.ty + dy,
        })
        return
      }

      if (selectionRef.current) {
        const world = toWorld(event)
        if (world) {
          const { startX, startY } = selectionRef.current
          setSelectionBox({
            x1: startX,
            y1: startY,
            x2: world.x,
            y2: world.y,
          })
        }
        return
      }

      const world = toWorld(event)
      if (world) {
        setLastPointer(world)
        if (store.dragState) {
          store.updateDragPosition(world)
        }
      }
    }

    const handleMouseUp = (event: MouseEvent) => {
      const world = toWorld(event)
      if (world) {
        setLastPointer(world)
      }
      const { endNodeDrag } = useCanvasStore.getState()
      endNodeDrag()
      if (selectionRef.current) {
        selectInBox()
        setSelectionBox(null)
        selectionRef.current = null
      }
      panRef.current = null
      document.body.style.setProperty("--canvas-cursor", "grab")
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      // ✅ Fix: Only handle events inside the canvas
      if (!target?.closest("[data-canvas-root]")) return

      if (target?.closest(MENU_SELECTOR)) {
        return
      }
      setContextMenu(null)

      const nodeEl = target?.closest(NODE_SELECTOR)
      const store = useCanvasStore.getState()

      // ✅ RIGHT CLICK ON CANVAS -> CANVAS MENU
      if (!nodeEl && event.button === 2) {
        const world = toWorld(event)
        if (world) {
          clearSelection()
          setContextMenu({
            type: "canvas",
            screenX: event.clientX,
            screenY: event.clientY,
            worldX: world.x,
            worldY: world.y,
          })
          event.preventDefault()
        }
        return
      }

      // ✅ RIGHT CLICK ON NODE -> NODE MENU
      if (nodeEl && event.button === 2) {
        const nodeId = nodeEl.getAttribute("data-node-id")
        const world = toWorld(event)
        if (nodeId && world) {
          // Select the node if not already selected
          if (!store.selectedNodeIds.includes(nodeId)) {
            store.setSelectedNodes([nodeId])
          }
          setContextMenu({
            type: "node",
            nodeId,
            screenX: event.clientX,
            screenY: event.clientY,
            worldX: world.x,
            worldY: world.y,
          })
          event.preventDefault()
        }
        return
      }

      if (!nodeEl && event.button === 0 && event.detail >= 2) {
        const world = toWorld(event)
        if (world) {
          clearSelection()
          selectionRef.current = { startX: world.x, startY: world.y }
          setSelectionBox({
            x1: world.x,
            y1: world.y,
            x2: world.x,
            y2: world.y,
          })
          event.preventDefault()
          return
        }
      }

      if (!nodeEl && event.button === 0 && event.shiftKey) {
        const world = toWorld(event)
        if (world) {
          clearSelection()
          selectionRef.current = { startX: world.x, startY: world.y }
          setSelectionBox({
            x1: world.x,
            y1: world.y,
            x2: world.x,
            y2: world.y,
          })
          event.preventDefault()
          return
        }
      }

      if (!nodeEl && event.button === 0) {
        const viewport = store.viewport
        panRef.current = { startX: event.clientX, startY: event.clientY, tx: viewport.tx, ty: viewport.ty }
        document.body.style.setProperty("--canvas-cursor", "grabbing")
        event.preventDefault()
        return
      }

      if (nodeEl && event.button === 0) {
        const nodeId = nodeEl.getAttribute("data-node-id")
        const world = toWorld(event)
        if (nodeId && world) {
          store.beginNodeDrag(nodeId, world)
          event.preventDefault()
        }
      }
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    window.addEventListener("mousedown", handleMouseDown)

    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
      window.removeEventListener("mousedown", handleMouseDown)
    }
  }, [clearSelection, selectInBox, setLastPointer, setSelectionBox])

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      const element = layerRef.current
      if (!element) return

      // ✅ Fix: Only zoom if hovering over canvas
      const target = event.target as HTMLElement | null
      if (!target?.closest("[data-canvas-root]")) return

      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const store = useCanvasStore.getState()
      const viewport = store.viewport

      // Scroll wheel = Zoom in/out at cursor position
      const factor = Math.exp(-event.deltaY * 0.0012)
      const nextScale = Math.min(3, Math.max(0.25, viewport.scale * factor))

      const worldX = (localX - viewport.tx) / viewport.scale
      const worldY = (localY - viewport.ty) / viewport.scale

      const nextTx = localX - worldX * nextScale
      const nextTy = localY - worldY * nextScale

      store.setViewport({
        tx: nextTx,
        ty: nextTy,
        scale: nextScale,
      })
    }

    window.addEventListener("wheel", handleWheel, { passive: false })
    return () => {
      window.removeEventListener("wheel", handleWheel)
    }
  }, [])

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      const editable = target.getAttribute("contenteditable")
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        editable === "" ||
        editable === "true"
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setKeyState("space", true)
        document.body.style.setProperty("--canvas-cursor", "grab")
      }

      if (isTextInput(event.target)) return

      const store = useCanvasStore.getState()

      const cmdOrCtrl = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (cmdOrCtrl && key === "c") {
        event.preventDefault()
        store.copySelected()
        return
      }

      if (cmdOrCtrl && key === "v") {
        event.preventDefault()
        store.pasteClipboard()
        return
      }

      if (key === "delete" || key === "backspace") {
        event.preventDefault()
        store.deleteSelected()
        return
      }

      if (cmdOrCtrl && key === "z") {
        event.preventDefault()
        if (event.shiftKey) {
          store.redo()
        } else {
          store.undo()
        }
        return
      }

      if (cmdOrCtrl && key === "y") {
        event.preventDefault()
        store.redo()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setKeyState("space", false)
        document.body.style.setProperty("--canvas-cursor", "default")
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [setKeyState])

  useEffect(() => {
    if (typeof window === "undefined") return
    const unsubscribe = useCanvasStore.subscribe((state) => {
      ; (window as any).__canvas_lastPointer = state.lastPointer
    })
    return () => unsubscribe()
  }, [])

  return (
    <>
      <div ref={layerRef} className="absolute inset-0" style={{ pointerEvents: "none", cursor: "grab" }} />
      {/* ✅ NODE CONTEXT MENU */}
      {contextMenu?.type === "node" &&
        createPortal(
          <div
            className="fixed z-50"
            style={{
              left: contextMenu.screenX,
              top: contextMenu.screenY,
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            data-canvas-context-menu
          >
            <div className="w-56 rounded-xl border border-white/10 bg-[#1e1e1e] p-1 text-white shadow-2xl backdrop-blur">
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                onClick={() => {
                  const store = useCanvasStore.getState()
                  const nodeId = contextMenu.nodeId
                  if (nodeId) {
                    // Disconnect: Remove all edges connected to this node
                    const edgesToRemove = store.edges.filter(e => e.source === nodeId || e.target === nodeId)
                    edgesToRemove.forEach(e => store.removeEdge(e.id))
                  }
                  setContextMenu(null)
                }}
              >
                Disconnect Node
              </button>
              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10"
                onClick={() => {
                  const store = useCanvasStore.getState()
                  if (contextMenu.nodeId) {
                    store.setSelectedNodes([contextMenu.nodeId])
                    store.copySelected()
                  }
                  setContextMenu(null)
                }}
              >
                Copy Node
              </button>

              <div className="my-1 h-px bg-white/10" />

              <button
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-red-400 hover:bg-white/10"
                onClick={() => {
                  const store = useCanvasStore.getState()
                  if (contextMenu.nodeId) {
                    store.setSelectedNodes([contextMenu.nodeId])
                    store.deleteSelected()
                  }
                  setContextMenu(null)
                }}
              >
                Delete Node
                <span className="text-xs opacity-50">⌫</span>
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* ✅ CANVAS CONTEXT MENU */}
      {contextMenu?.type === "canvas" &&
        createPortal(
          <div
            className="fixed z-50"
            style={{
              left: contextMenu.screenX,
              top: contextMenu.screenY,
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            data-canvas-context-menu
          >
            <div className="w-64 rounded-2xl border border-white/10 bg-neutral-950/95 p-2 text-white shadow-2xl backdrop-blur">
              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70">
                Add to canvas
              </div>
              <div className="space-y-1">
                {CONTEXT_MENU_VARIANTS.map((item) => (
                  <button
                    key={item.variant}
                    type="button"
                    className="flex w-full flex-col rounded-xl px-3 py-2 text-left transition hover:bg-white/5"
                    onClick={(event) => {
                      event.preventDefault()
                      handleMenuSelect(item.variant)
                    }}
                  >
                    <span className="text-sm font-semibold">{item.label}</span>
                    <span className="text-xs text-white/60">{item.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export const InteractionLayer = memo(InteractionLayerComponent)
export default InteractionLayer