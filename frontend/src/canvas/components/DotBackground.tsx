import { memo } from "react"
import {
  CANVAS_DOT_GAP,
  CANVAS_DOT_RADIUS,
  CANVAS_WORLD_HALF_EXTENT,
} from "@/canvas/constants"

const DotBackgroundComponent = () => {
  const size = CANVAS_WORLD_HALF_EXTENT

  return (
    <svg
      width={size * 2}
      height={size * 2}
      viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: -size,
        top: -size,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <defs>
        <pattern
          id="workflowDotPattern"
          x="0"
          y="0"
          width={CANVAS_DOT_GAP}
          height={CANVAS_DOT_GAP}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={CANVAS_DOT_GAP / 2}
            cy={CANVAS_DOT_GAP / 2}
            r={CANVAS_DOT_RADIUS}
            fill="var(--canvas-dot-color)"
          />
        </pattern>
      </defs>

      <rect
        x={-size}
        y={-size}
        width={size * 2}
        height={size * 2}
        fill="url(#workflowDotPattern)"
      />
    </svg>
  )
}

export const DotBackground = memo(DotBackgroundComponent)
export default DotBackground
