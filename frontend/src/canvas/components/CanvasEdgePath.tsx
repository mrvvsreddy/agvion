interface CanvasEdgePathProps {
  path: string
  highlighted?: boolean
  accent?: string
}

export const CanvasEdgePath = ({ path, highlighted, accent }: CanvasEdgePathProps) => {
  const activeStroke = accent || "rgba(226,232,240,0.85)"
  const glowStroke =
    accent?.replace(/,\s*[\d.]+\)$/, ",0.35)") || "rgba(148,163,184,0.35)"
  const highlightStroke = accent || "rgba(255,255,255,0.95)"

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke="rgba(2, 6, 23, 0.85)"
        strokeWidth={7}
        strokeLinecap="round"
        style={{ vectorEffect: "non-scaling-stroke" }}
      />
      <path
        d={path}
        fill="none"
        stroke={glowStroke}
        strokeWidth={highlighted ? 5 : 4}
        strokeLinecap="round"
        opacity={highlighted ? 0.9 : 0.6}
        style={{ vectorEffect: "non-scaling-stroke" }}
      />
      <path
        d={path}
        fill="none"
        stroke={highlighted ? highlightStroke : activeStroke}
        strokeWidth={highlighted ? 3.5 : 2.6}
        strokeLinecap="round"
        markerEnd="url(#workflowEdgeArrow)"
        style={{ vectorEffect: "non-scaling-stroke" }}
      />
    </g>
  )
}

export default CanvasEdgePath
