import { useCallback, useEffect, useRef } from "react"

import DotBackground from "@/canvas/components/DotBackground"
import EdgeLayer from "@/canvas/components/EdgeLayer"
import InteractionLayer from "@/canvas/components/InteractionLayer"
import NodeLayer from "@/canvas/components/NodeLayer"
import SelectionBoxOverlay from "@/canvas/components/SelectionBoxOverlay"
import PathDialogHost from "@/canvas/components/PathDialogHost"
import { NodeEditorPanel } from "@/canvas/components/NodeEditorPanel"
import { CANVAS_GRID_SIZE, CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from "@/canvas/constants"
import useCanvasStore from "@/canvas/store"
if (typeof window !== "undefined") {
  ; (window as any).__canvasStore = useCanvasStore
}

type CanvasShellProps = {
  workflowId?: string | null
  hasUnsavedChanges?: boolean
  dndTypes?: Record<string, { title: string }>
  onPaneClick?: () => void
  onSave?: (workflowData: { nodes: any[]; edges: any[] }) => Promise<void>
}

type AddNodeDetail = {
  integrationId?: string
  nodeId?: string
  name?: string
  type?: "trigger" | "action"
  prompt?: string
}

const VARIANT_SUBTITLE: Record<"channel" | "agent" | "tool", string> = {
  channel: "Omnichannel",
  agent: "Reasoning",
  tool: "Automation",
}

const VARIANT_DESCRIPTION: Record<"channel" | "agent" | "tool", string> = {
  channel: "Entry point that captures a user's request from any channel.",
  agent: "Let the agent reason with context, craft replies, and branch flows.",
  tool: "Trigger an automation, webhook, or scripted capability.",
}

const VARIANT_ACCENT: Record<"channel" | "agent" | "tool", string> = {
  channel: "rgba(125,211,252,1)",
  agent: "rgba(16,185,129,1)",
  tool: "rgba(196,181,253,1)",
}

const CanvasShell = (_props: CanvasShellProps) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const viewport = useCanvasStore((state) => state.viewport)
  const zoomTo = useCanvasStore((state) => state.zoomTo)

  // Add beforeunload warning for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Show browser's native confirmation dialog
      e.preventDefault()
      // Modern browsers require returnValue to be set
      e.returnValue = "You have unsaved changes. Are you sure you want to leave?"
      return "You have unsaved changes. Are you sure you want to leave?"
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [])

  const snap = useCallback((value: number) => Math.round(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE, [])

  const zoomByFactor = (factor: number) => {
    const element = rootRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const centerX = rect.width / 2
    const centerY = rect.height / 2
    zoomTo(viewport.scale * factor, centerX, centerY)
  }

  const fitToScreen = useCallback(() => {
    const element = rootRef.current
    if (!element) return
    const { nodes, setViewport } = useCanvasStore.getState()
    if (nodes.length === 0) {
      setViewport({ tx: 0, ty: 0, scale: 1 })
      return
    }

    const minX = Math.min(...nodes.map((node) => node.x))
    const maxX = Math.max(...nodes.map((node) => node.x + CANVAS_NODE_WIDTH))
    const minY = Math.min(...nodes.map((node) => node.y))
    const maxY = Math.max(...nodes.map((node) => node.y + CANVAS_NODE_HEIGHT))

    const padding = 80
    const contentWidth = maxX - minX + padding * 2
    const contentHeight = maxY - minY + padding * 2
    const viewWidth = element.clientWidth
    const viewHeight = element.clientHeight

    if (viewWidth === 0 || viewHeight === 0) return

    const nextScale = Math.min(3, Math.max(0.25, Math.min(viewWidth / contentWidth, viewHeight / contentHeight)))
    const centerX = minX + (maxX - minX) / 2
    const centerY = minY + (maxY - minY) / 2
    const tx = viewWidth / 2 - centerX * nextScale
    const ty = viewHeight / 2 - centerY * nextScale

    setViewport({ tx, ty, scale: nextScale })
  }, [])

  const createNodeAtCenter = useCallback(
    (detail?: AddNodeDetail) => {
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      const { viewport: vp, addNode } = useCanvasStore.getState()
      const clientX = rect.left + rect.width / 2
      const clientY = rect.top + rect.height / 2
      const worldX = (clientX - rect.left - vp.tx) / vp.scale
      const worldY = (clientY - rect.top - vp.ty) / vp.scale

      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `node-${Date.now()}`
      const integrationId = detail?.integrationId || "custom"
      const nodeId = detail?.nodeId || "custom-node"
      const name = detail?.name || "New Node"
      const type = detail?.type === "trigger" ? "trigger" : "action"
      const variant: "channel" | "agent" | "tool" =
        type === "trigger" ? "channel" : integrationId === "tool" ? "tool" : "agent"

      const prompt =
        variant === "agent"
          ? detail?.prompt ||
          "You are an orchestrator. Understand the customer's ask, call the right tools, and craft a helpful response."
          : undefined
      const paths =
        variant === "agent"
          ? [
            {
              id: `path-${id}`,
              label: "Use Tool",
              description: "Trigger a connected tool for this branch.",
              tone: "info" as const,
            },
          ]
          : undefined

      addNode({
        id,
        x: snap(worldX - CANVAS_NODE_WIDTH / 2),
        y: snap(worldY - CANVAS_NODE_HEIGHT / 2),
        nodeId,
        integrationId,
        name,
        type,
        shape: "square",
        variant,
        badge: VARIANT_SUBTITLE[variant],
        subtitle: VARIANT_SUBTITLE[variant],
        description: VARIANT_DESCRIPTION[variant],
        prompt,
        paths,
        meta: { createdAt: Date.now(), source: "workflow-event" },
        accentColor: VARIANT_ACCENT[variant],
      })
    },
    [snap],
  )

  useEffect(() => {
    if (typeof window === "undefined") return

    const handleAddNode = (event: Event) => {
      createNodeAtCenter((event as CustomEvent<AddNodeDetail>).detail)
    }
    const handleZoomIn = () => zoomByFactor(1.1)
    const handleZoomOut = () => zoomByFactor(1 / 1.1)
    const handleZoomReset = () => {
      const element = rootRef.current
      const width = element?.clientWidth ?? 0
      const height = element?.clientHeight ?? 0
      zoomTo(1, width / 2, height / 2)
    }
    const handleFit = () => fitToScreen()

    window.addEventListener("workflow:add-node", handleAddNode as EventListener)
    window.addEventListener("workflow:zoom-in", handleZoomIn)
    window.addEventListener("workflow:zoom-out", handleZoomOut)
    window.addEventListener("workflow:zoom-reset", handleZoomReset)
    window.addEventListener("workflow:fit-to-screen", handleFit)

    return () => {
      window.removeEventListener("workflow:add-node", handleAddNode as EventListener)
      window.removeEventListener("workflow:zoom-in", handleZoomIn)
      window.removeEventListener("workflow:zoom-out", handleZoomOut)
      window.removeEventListener("workflow:zoom-reset", handleZoomReset)
      window.removeEventListener("workflow:fit-to-screen", handleFit)
    }
  }, [createNodeAtCenter, fitToScreen, zoomByFactor, zoomTo])

  useEffect(() => {
    if (typeof window === "undefined") return

    const emitZoom = (scale: number) => {
      window.dispatchEvent(new CustomEvent("workflow:zoom-change", { detail: { scale } }))
    }
    const emitNodeCount = (count: number) => {
      window.dispatchEvent(new CustomEvent("workflow:nodes-change", { detail: { count } }))
    }

    emitZoom(useCanvasStore.getState().viewport.scale)
    emitNodeCount(useCanvasStore.getState().nodes.length)

    const unsubscribeZoom = useCanvasStore.subscribe((state) => {
      emitZoom(state.viewport.scale)
    })
    const unsubscribeNodes = useCanvasStore.subscribe((state) => {
      emitNodeCount(state.nodes.length)
    })

    return () => {
      unsubscribeZoom()
      unsubscribeNodes()
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        const { workflowId } = _props
        if (workflowId) {
          useCanvasStore.getState().saveWorkflow(workflowId)
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [_props.workflowId])

  useEffect(() => {
    if (_props.workflowId) {
      useCanvasStore.getState().loadWorkflow(_props.workflowId)
    }
  }, [_props.workflowId])

  const isDirty = useCanvasStore((state) => state.isDirty)

  return (
    <div ref={rootRef} data-canvas-root className="relative h-full w-full overflow-hidden bg-neutral-950">
      <div className="absolute right-4 top-4 z-20 flex gap-2">
        <button
          className={`rounded px-3 py-1 text-xs font-medium border transition-colors ${isDirty
            ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/30"
            : "bg-teal-500/10 text-teal-300 border-teal-500/20 hover:bg-teal-500/20"
            }`}
          onClick={() => {
            if (_props.workflowId) {
              useCanvasStore.getState().saveWorkflow(_props.workflowId)
            }
          }}
        >
          {isDirty ? "Save*" : "Saved"}
        </button>
        <button
          className="rounded bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
          onClick={() => zoomByFactor(1 / 1.1)}
        >
          Zoom Out
        </button>
        <button
          className="rounded bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
          onClick={() => zoomByFactor(1.1)}
        >
          Zoom In
        </button>
      </div>
      <div className="absolute inset-0 overflow-visible" style={{ cursor: "var(--canvas-cursor, default)" }}>
        <div
          ref={wrapperRef}
          className="absolute inset-0 z-10"
          style={{
            transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
            transformOrigin: "0 0",
          }}
        >
          <DotBackground />
          <EdgeLayer />
          <NodeLayer />
          <SelectionBoxOverlay />
        </div>
      </div>
      <InteractionLayer />
      <PathDialogHost />
      <NodeEditorPanel />
    </div>
  )
}

export default CanvasShell

