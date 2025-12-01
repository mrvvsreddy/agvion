import { memo } from "react"

import useCanvasStore from "@/canvas/store"

const SelectionBoxOverlayComponent = () => {
  const selectionBox = useCanvasStore((state) => state.selectionBox)

  if (!selectionBox) return null

  const { x1, y1, x2, y2 } = selectionBox
  const left = Math.min(x1, x2)
  const top = Math.min(y1, y2)
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)

  if (width === 0 && height === 0) return null

  return (
    <div
      aria-hidden
      className="absolute border border-sky-500/70 bg-sky-500/10"
      style={{
        left,
        top,
        width,
        height,
        pointerEvents: "none",
      }}
    />
  )
}

export const SelectionBoxOverlay = memo(SelectionBoxOverlayComponent)
export default SelectionBoxOverlay


