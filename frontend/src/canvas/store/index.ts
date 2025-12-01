import { create } from "zustand"

import { CANVAS_GRID_SIZE, CANVAS_NODE_HEIGHT, CANVAS_NODE_WIDTH } from "@/canvas/constants"

export type CanvasNodeType = "trigger" | "action"

export type CanvasNodeShape = "square" | "circle"

export type CanvasNodeVariant = "channel" | "agent" | "tool" | "knowledge" | "skill"

export interface CanvasNode {

  id: string

  x: number

  y: number

  nodeId: string

  integrationId: string

  name: string

  type: CanvasNodeType

  shape: CanvasNodeShape

  variant: CanvasNodeVariant

  badge?: string

  subtitle?: string

  description?: string

  prompt?: string

  paths?: CanvasNodePath[]

  meta?: Record<string, any>

  accentColor?: string

  model?: string

}

export interface CanvasNodePath {

  id: string

  label: string

  description?: string

  tone?: "default" | "warning" | "info"

  icon?: string

  provider?: string

  type?: CanvasNodeVariant

  meta?: Record<string, any>

}

export interface CanvasEdge {

  id: string

  source: string

  target: string

  label?: string

  sourceHandle?: string

  // ✅ ADDED FOR PERFECT WIRE SNAPPING

  endX?: number

  endY?: number

}

export interface CanvasViewport {

  tx: number

  ty: number

  scale: number

}

export interface CanvasSnapshot {

  nodes: CanvasNode[]

  edges: CanvasEdge[]

  viewport: CanvasViewport

}

export interface CanvasStore {

  nodes: CanvasNode[]

  edges: CanvasEdge[]

  viewport: CanvasViewport

  lastPointer: { x: number; y: number } | null

  keys: { space: boolean }

  focusedNodeId: string | null

  selectedNodeIds: string[]

  hoveredHandle: { nodeId: string; port: "in" | "out" } | null

  dragState: { nodeId: string; offsetX: number; offsetY: number } | null

  connectingFrom: {

    nodeId: string

    port: "out"

    startX: number

    startY: number

    cursorX: number

    cursorY: number

    pathId?: string

  } | null

  clipboard: CanvasNode[] | null

  selectionBox: { x1: number; y1: number; x2: number; y2: number } | null

  history: CanvasSnapshot[]

  future: CanvasSnapshot[]

  setNodes: (nodes: CanvasNode[]) => void

  setEdges: (edges: CanvasEdge[]) => void

  addNode: (node: CanvasNode) => void

  addEdge: (edge: CanvasEdge) => void

  removeEdge: (edgeId: string) => void

  setViewport: (viewport: CanvasViewport) => void

  panBy: (dx: number, dy: number) => void

  zoomTo: (scale: number, clientX: number, clientY: number) => void

  setLastPointer: (point: { x: number; y: number } | null) => void

  setKeyState: (key: "space", pressed: boolean) => void

  setFocusedNode: (nodeId: string | null) => void

  setSelectedNodes: (ids: string[]) => void

  toggleNodeSelection: (id: string, multi: boolean) => void

  clearSelection: () => void

  setHoveredHandle: (payload: { nodeId: string; port: "in" | "out" } | null) => void

  startConnection: (nodeId: string, startX: number, startY: number, pathId?: string) => void

  updateConnectionPointer: (worldX: number, worldY: number) => void

  // ✅ UPDATED SIGNATURE

  endConnection: (

    targetNodeId: string | null,

    endPoint?: { x: number; y: number } | null

  ) => void

  beginNodeDrag: (nodeId: string, pointer: { x: number; y: number }) => void

  updateDragPosition: (pointer: { x: number; y: number }) => void

  endNodeDrag: () => void

  copySelected: () => void

  pasteClipboard: () => void

  deleteSelected: () => void

  updateNode: (nodeId: string, updater: (node: CanvasNode) => CanvasNode) => void

  addPathToNode: (nodeId: string) => void

  addCustomPathToNode: (nodeId: string, path: Partial<CanvasNodePath>) => void

  removePathFromNode: (nodeId: string, pathId: string) => void

  openPathDialog: (nodeId: string, variant: CanvasNodeVariant) => void

  closePathDialog: () => void

  pathDialog: { nodeId: string; variant: CanvasNodeVariant } | null

  setSelectionBox: (box: { x1: number; y1: number; x2: number; y2: number } | null) => void

  selectInBox: () => void

  snapshot: () => void

  undo: () => void

  redo: () => void

  saveWorkflow: (workflowId: string) => void

  loadWorkflow: (workflowId: string) => void

  isDirty: boolean

  quickAddNodeId: string | null
  setQuickAddNodeId: (id: string | null) => void

  // Node Editor
  editingNodeId: string | null
  setEditingNodeId: (id: string | null) => void

}

const MAX_HISTORY = 100

const cloneSnapshot = (snapshot: CanvasSnapshot): CanvasSnapshot => ({

  nodes: snapshot.nodes.map((n) => ({ ...n })),

  edges: snapshot.edges.map((e) => ({ ...e })),

  viewport: { ...snapshot.viewport },

})

export const useCanvasStore = create<CanvasStore>()((set, get) => ({

  nodes: [],

  edges: [],

  viewport: { tx: 0, ty: 0, scale: 1 },

  lastPointer: null,

  keys: { space: false },

  focusedNodeId: null,

  selectedNodeIds: [],

  hoveredHandle: null,

  dragState: null,

  connectingFrom: null,

  pathDialog: null,

  clipboard: null,

  selectionBox: null,

  history: [],

  future: [],

  isDirty: false,

  quickAddNodeId: null,
  setQuickAddNodeId: (nodeId) => set({ quickAddNodeId: nodeId }),

  editingNodeId: null,
  setEditingNodeId: (id) => set({ editingNodeId: id }),

  setNodes: (nodes) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return { nodes, history, future: [], isDirty: true }
    }),

  setEdges: (edges) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return { edges, history, future: [], isDirty: true }
    }),

  addNode: (node) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        nodes: [...state.nodes, node],
        history,
        future: [],
        isDirty: true,
      }
    }),

  addEdge: (edge) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        edges: [...state.edges, edge],
        history,
        future: [],
        isDirty: true,
      }
    }),

  removeEdge: (edgeId) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        edges: state.edges.filter((edge) => edge.id !== edgeId),
        history,
        future: [],
        isDirty: true,
      }
    }),

  setViewport: (viewport) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return { viewport, history, future: [] }
    }),

  panBy: (dx, dy) =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        viewport: {
          ...state.viewport,
          tx: state.viewport.tx + dx,
          ty: state.viewport.ty + dy,
        },
        history,
        future: [],
      }
    }),

  zoomTo: (nextScale, clientX, clientY) =>
    set((state) => {
      const prevScale = state.viewport.scale
      const clamped = Math.min(3, Math.max(0.25, nextScale))
      const worldX = (clientX - state.viewport.tx) / prevScale
      const worldY = (clientY - state.viewport.ty) / prevScale
      const newTx = clientX - worldX * clamped
      const newTy = clientY - worldY * clamped
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        viewport: {
          tx: newTx,
          ty: newTy,
          scale: clamped,
        },
        history,
        future: [],
      }
    }),

  setLastPointer: (point) => set({ lastPointer: point }),

  setKeyState: (key, pressed) =>
    set((state) => ({
      keys: {
        ...state.keys,
        [key]: pressed,
      },
    })),

  setFocusedNode: (nodeId) => set({ focusedNodeId: nodeId }),

  setSelectedNodes: (ids) => set({ selectedNodeIds: ids }),

  toggleNodeSelection: (id, multi) =>
    set((state) => {
      if (!multi) {
        return { selectedNodeIds: [id] }
      }
      const exists = state.selectedNodeIds.includes(id)
      return {
        selectedNodeIds: exists
          ? state.selectedNodeIds.filter((nId) => nId !== id)
          : [...state.selectedNodeIds, id],
      }
    }),

  clearSelection: () => set({ selectedNodeIds: [] }),

  setHoveredHandle: (payload) => set({ hoveredHandle: payload }),

  startConnection: (nodeId, startX, startY, pathId) =>
    set({
      connectingFrom: {
        nodeId,
        port: "out",
        startX,
        startY,
        cursorX: startX,
        cursorY: startY,
        pathId: pathId ?? undefined,
      },
    }),

  updateConnectionPointer: (worldX, worldY) =>
    set((state) => {
      if (!state.connectingFrom) return {}
      return {
        connectingFrom: { ...state.connectingFrom, cursorX: worldX, cursorY: worldY },
      }
    }),

  // ✅ ✅ ✅ FINAL FIXED WIRE CONNECTION

  endConnection: (targetNodeId, endPoint) =>
    set((state) => {
      const conn = state.connectingFrom
      if (!conn || !targetNodeId || conn.nodeId === targetNodeId) {
        return { connectingFrom: null }
      }

      const duplicate = state.edges.some(
        (edge) =>
          edge.source === conn.nodeId &&
          edge.target === targetNodeId &&
          edge.sourceHandle === conn.pathId,
      )
      if (duplicate) return { connectingFrom: null }

      const newEdge: CanvasEdge = {
        id: `e-${conn.nodeId}-${targetNodeId}-${Date.now()}`,
        source: conn.nodeId,
        target: targetNodeId,
        sourceHandle: conn.pathId,
        // ✅ EXACT INPUT DOT POSITION
        endX: endPoint?.x,
        endY: endPoint?.y,
      }

      return {
        edges: [...state.edges, newEdge],
        connectingFrom: null,
        isDirty: true,
      }
    }),

  // ALL OTHER FUNCTIONS REMAIN UNTOUCHED

  beginNodeDrag: (nodeId, pointer) =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === nodeId)
      if (!node) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        dragState: {
          nodeId,
          offsetX: pointer.x - node.x,
          offsetY: pointer.y - node.y,
        },
        focusedNodeId: nodeId,
        history,
        future: [],
      }
    }),

  updateDragPosition: (pointer) =>
    set((state) => {
      const drag = state.dragState
      if (!drag) return {}
      const snap = (value: number) => Math.round(value / CANVAS_GRID_SIZE) * CANVAS_GRID_SIZE
      const nextX = snap(pointer.x - drag.offsetX)
      const nextY = snap(pointer.y - drag.offsetY)
      return {
        nodes: state.nodes.map((node) => (node.id === drag.nodeId ? { ...node, x: nextX, y: nextY } : node)),
        isDirty: true,
      }
    }),

  endNodeDrag: () => set({ dragState: null }),

  copySelected: () => {
    const { selectedNodeIds, nodes } = get()
    if (!selectedNodeIds.length) return
    const idSet = new Set(selectedNodeIds)
    const copied = nodes.filter((n) => idSet.has(n.id)).map((n) => ({ ...n }))
    set({ clipboard: copied })
  },

  pasteClipboard: () =>
    set((state) => {
      if (!state.clipboard || state.clipboard.length === 0) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      const OFFSET = 32
      const idMap = new Map<string, string>()
      const now = Date.now()
      const newNodes = state.clipboard.map((node, index) => {
        const newId = `${node.id}-copy-${now}-${index}`
        idMap.set(node.id, newId)
        return {
          ...node,
          id: newId,
          x: node.x + OFFSET,
          y: node.y + OFFSET,
        }
      })
      const clipboardIdSet = new Set(state.clipboard.map((n) => n.id))
      const newEdges: CanvasEdge[] = state.edges
        .filter((edge) => clipboardIdSet.has(edge.source) && clipboardIdSet.has(edge.target))
        .map((edge, index) => ({
          ...edge,
          id: `e-copy-${now}-${index}`,
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
        }))
      return {
        nodes: [...state.nodes, ...newNodes],
        edges: [...state.edges, ...newEdges],
        selectedNodeIds: newNodes.map((n) => n.id),
        history,
        future: [],
        isDirty: true,
      }
    }),

  deleteSelected: () =>
    set((state) => {
      if (!state.selectedNodeIds.length) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      const toDelete = new Set(state.selectedNodeIds)
      return {
        nodes: state.nodes.filter((node) => !toDelete.has(node.id)),
        edges: state.edges.filter((edge) => !toDelete.has(edge.source) && !toDelete.has(edge.target)),
        selectedNodeIds: [],
        focusedNodeId: null,
        history,
        future: [],
        isDirty: true,
      }
    }),

  updateNode: (nodeId, updater) =>
    set((state) => {
      const target = state.nodes.find((node) => node.id === nodeId)
      if (!target) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        nodes: state.nodes.map((node) => (node.id === nodeId ? updater(node) : node)),
        history,
        future: [],
        isDirty: true,
      }
    }),

  addCustomPathToNode: (nodeId, pathData) =>
    set((state) => {
      const target = state.nodes.find((node) => node.id === nodeId)
      if (!target) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      const nextPathId = `path-${Date.now()}`
      const nextPathIndex = (target.paths?.length || 0) + 1
      const nextPath: CanvasNodePath = {
        id: nextPathId,
        label: pathData.label || `Path ${nextPathIndex}`,
        description: pathData.description || "Connect a tool or action to this outcome.",
        tone: pathData.tone,
        icon: pathData.icon,
        provider: pathData.provider,
        type: pathData.type,
        meta: pathData.meta,
      }
      return {
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
              ...node,
              paths: [...(node.paths || []), nextPath],
            }
            : node,
        ),
        history,
        future: [],
        isDirty: true,
      }
    }),

  addPathToNode: (nodeId) => get().addCustomPathToNode(nodeId, {}),

  removePathFromNode: (nodeId, pathId) =>
    set((state) => {
      const target = state.nodes.find((node) => node.id === nodeId)
      if (!target) return {}
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return {
        nodes: state.nodes.map((node) =>
          node.id === nodeId
            ? {
              ...node,
              paths: (node.paths || []).filter((path) => path.id !== pathId),
            }
            : node,
        ),
        edges: state.edges.filter(
          (edge) => !(edge.source === nodeId && edge.sourceHandle === pathId),
        ),
        history,
        future: [],
        isDirty: true,
      }
    }),

  openPathDialog: (nodeId, variant) => set({ pathDialog: { nodeId, variant } }),

  closePathDialog: () => set({ pathDialog: null }),

  setSelectionBox: (box) => set({ selectionBox: box }),

  selectInBox: () =>
    set((state) => {
      if (!state.selectionBox) return {}
      const { x1, y1, x2, y2 } = state.selectionBox
      const minX = Math.min(x1, x2)
      const maxX = Math.max(x1, x2)
      const minY = Math.min(y1, y2)
      const maxY = Math.max(y1, y2)
      const selectedNodeIds = state.nodes
        .filter((node) => {
          const nodeMinX = node.x
          const nodeMaxX = node.x + CANVAS_NODE_WIDTH
          const nodeMinY = node.y
          const nodeMaxY = node.y + CANVAS_NODE_HEIGHT
          const intersects =
            nodeMinX < maxX && nodeMaxX > minX && nodeMinY < maxY && nodeMaxY > minY
          return intersects
        })
        .map((node) => node.id)
      return {
        selectedNodeIds,
      }
    }),

  snapshot: () =>
    set((state) => {
      const snap: CanvasSnapshot = { nodes: state.nodes, edges: state.edges, viewport: state.viewport }
      const history = [...state.history, cloneSnapshot(snap)].slice(-MAX_HISTORY)
      return { history, future: [] }
    }),

  undo: () =>
    set((state) => {
      if (state.history.length === 0) return {}
      const current: CanvasSnapshot = {
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      }
      const history = state.history.slice(0, -1)
      const previous = state.history[state.history.length - 1]
      const future = [...state.future, cloneSnapshot(current)].slice(-MAX_HISTORY)
      return {
        nodes: previous.nodes.map((n) => ({ ...n })),
        edges: previous.edges.map((e) => ({ ...e })),
        viewport: { ...previous.viewport },
        history,
        future,
        isDirty: true,
      }
    }),

  redo: () =>
    set((state) => {
      if (state.future.length === 0) return {}
      const current: CanvasSnapshot = {
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      }
      const future = state.future.slice(0, -1)
      const next = state.future[state.future.length - 1]
      const history = [...state.history, cloneSnapshot(current)].slice(-MAX_HISTORY)
      return {
        nodes: next.nodes.map((n) => ({ ...n })),
        edges: next.edges.map((e) => ({ ...e })),
        viewport: { ...next.viewport },
        history,
        future,
        isDirty: true,
      }
    }),

  saveWorkflow: (workflowId) => {
    const { nodes, edges, viewport } = get()
    const data = { nodes, edges, viewport }
    try {
      localStorage.setItem(`workflow-${workflowId}`, JSON.stringify(data))
      console.log(`Saved workflow ${workflowId}`)
      set({ isDirty: false })
    } catch (e) {
      console.error("Failed to save workflow", e)
    }
  },

  loadWorkflow: (workflowId) => {
    try {
      const raw = localStorage.getItem(`workflow-${workflowId}`)
      if (raw) {
        const data = JSON.parse(raw)
        set({
          nodes: data.nodes || [],
          edges: data.edges || [],
          viewport: data.viewport || { tx: 0, ty: 0, scale: 1 },
          history: [],
          future: [],
          selectedNodeIds: [],
          focusedNodeId: null,
          isDirty: false,
        })
        console.log(`Loaded workflow ${workflowId}`)
        return
      }
    } catch (e) {
      console.error("Failed to load workflow", e)
    }

    // Default empty state if no saved data
    set({
      nodes: [],
      edges: [],
      viewport: { tx: 0, ty: 0, scale: 1 },
      history: [],
      future: [],
      selectedNodeIds: [],
      focusedNodeId: null,
      isDirty: false,
    })
  },

}))



export default useCanvasStore

