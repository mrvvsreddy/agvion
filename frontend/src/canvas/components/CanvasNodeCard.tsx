import React from "react"
import { AlertTriangle, BookOpenCheck, MessageSquare, Plus, Sparkles } from "lucide-react"

import { CANVAS_NODE_RADIUS, CANVAS_NODE_WIDTH } from "@/canvas/constants"
import type { CanvasNode, CanvasNodeVariant } from "@/canvas/store"
import { ICON_REGISTRY } from "@/canvas/registry"

interface CanvasNodeCardProps {
  node: CanvasNode
  focused?: boolean
  selected?: boolean
  onAddCard?: () => void
  onAddSpecificPath?: (type: CanvasNodeVariant) => void
  onPathPointerDown?: (pathId: string, event: React.PointerEvent<HTMLButtonElement>) => void
  onRemovePath?: (pathId: string) => void
}

const VARIANT_THEME: Record<
  CanvasNodeVariant,
  {
    bg: string
    border: string
    borderActive: string
    shadow: string
    badgeBg: string
    badgeText: string
    accent: string
    title: string
  }
> = {
  channel: {
    bg: "linear-gradient(145deg, rgba(13,16,24,0.92), rgba(10,14,23,0.98))",
    border: "rgba(94,106,143,0.4)",
    borderActive: "rgba(125,211,252,0.9)",
    shadow: "0px 25px 60px rgba(3,7,18,0.65)",
    badgeBg: "rgba(250,204,21,0.12)",
    badgeText: "rgba(250,204,21,0.9)",
    accent: "rgba(250,204,21,1)",
    title: "Omnichannel",
  },
  agent: {
    bg: "linear-gradient(145deg, rgba(10,16,32,0.96), rgba(12,36,52,0.95))",
    border: "rgba(129,140,248,0.35)",
    borderActive: "rgba(196,181,253,0.9)",
    shadow: "0px 30px 70px rgba(15,23,42,0.75)",
    badgeBg: "rgba(192,132,252,0.18)",
    badgeText: "rgba(216,180,254,1)",
    accent: "rgba(147,197,253,1)",
    title: "Reasoning",
  },
  tool: {
    bg: "linear-gradient(145deg, rgba(20,10,25,0.94), rgba(30,15,40,0.95))", // More purple/dark
    border: "rgba(167,139,250,0.35)", // Violet
    borderActive: "rgba(196,181,253,0.9)",
    shadow: "0px 30px 65px rgba(20,10,25,0.7)",
    badgeBg: "rgba(167,139,250,0.15)",
    badgeText: "rgba(221,214,254,1)",
    accent: "rgba(221,214,254,1)",
    title: "Automation",
  },
  knowledge: {
    bg: "linear-gradient(145deg, rgba(25,15,5,0.94), rgba(40,20,10,0.95))", // More orange/brown
    border: "rgba(249,115,22,0.35)", // Orange
    borderActive: "rgba(253,186,116,0.9)",
    shadow: "0px 30px 65px rgba(25,15,5,0.7)",
    badgeBg: "rgba(249,115,22,0.15)",
    badgeText: "rgba(253,186,116,1)",
    accent: "rgba(253,186,116,1)",
    title: "Knowledge",
  },
  skill: {
    bg: "linear-gradient(145deg, rgba(25,5,15,0.94), rgba(40,10,25,0.95))", // More pink/red
    border: "rgba(236,72,153,0.35)", // Pink
    borderActive: "rgba(249,168,212,0.9)",
    shadow: "0px 30px 65px rgba(25,5,15,0.7)",
    badgeBg: "rgba(236,72,153,0.15)",
    badgeText: "rgba(249,168,212,1)",
    accent: "rgba(249,168,212,1)",
    title: "Skill",
  },
}

const toneClasses: Record<string, string> = {
  default: "border-white/5 text-neutral-100",
  warning: "border-amber-400/50 text-amber-200",
  info: "border-sky-500/40 text-sky-200",
}

const PlaceholderText = ({ text }: { text: string }) => (
  <span className="text-sm text-white/50">{text}</span>
)

export function CanvasNodeCard({
  node,
  focused,
  selected,
  onAddCard,
  onAddSpecificPath,
  onPathPointerDown,
  onRemovePath,
}: CanvasNodeCardProps) {
  const [showAddMenu, setShowAddMenu] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false)
      }
    }
    if (showAddMenu) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showAddMenu])

  const variant = node.variant || "agent"
  const theme = VARIANT_THEME[variant]
  const badgeLabel = variant.toUpperCase()
  const subtitle = node.subtitle || node.integrationId || theme.title

  const renderAgentSections = () => {
    const prompt = node.prompt?.trim()
    // ✅ REMOVED OLD KNOWLEDGE SECTION

    return (
      <>
        <section className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            <MessageSquare className="h-3.5 w-3.5 text-white/60" />
            Instructions
          </div>
          <p className="mt-2 text-sm leading-relaxed text-white/90">
            {prompt || "Describe how this agent should reason, respond, and route conversations."}
          </p>
        </section>
      </>
    )
  }

  const renderAddCard = () => {
    if (variant === "agent") {
      const existingTypes = new Set(node.paths?.map(p => p.type) || [])
      const options: CanvasNodeVariant[] = ["knowledge", "skill", "tool"]
      const availableOptions = options.filter(opt => !existingTypes.has(opt))

      if (availableOptions.length === 0) return null

      return (
        <div className="relative mt-4" ref={menuRef}>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-2xl border border-dashed border-white/20 px-4 py-3 text-left text-sm font-medium text-white/80 transition hover:border-white/40 hover:bg-white/5"
            onClick={() => setShowAddMenu(!showAddMenu)}
          >
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-white/60" />
              Add Card
            </div>
            <Sparkles className="h-4 w-4 text-white/40" />
          </button>

          {showAddMenu && (
            <div className="absolute left-0 top-full z-20 mt-2 w-full overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-xl">
              {availableOptions.map((opt) => (
                <button
                  key={opt}
                  className="flex w-full items-center gap-2 px-4 py-2 text-sm text-white/80 hover:bg-white/10"
                  onClick={() => {
                    onAddSpecificPath?.(opt)
                    setShowAddMenu(false)
                  }}
                >
                  <span className="capitalize">{opt}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )
    }

    // For other nodes, show specific text
    const addLabel = variant === "channel" ? "Add Channel" : variant === "tool" ? "Add Tool" : "Add Card"

    return (
      <button
        type="button"
        className="mt-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-white/20 px-4 py-3 text-left text-sm font-medium text-white/80 transition hover:border-white/40 hover:bg-white/5"
        onClick={() => {
          onAddCard?.()
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("workflow:open-palette"))
          }
        }}
      >
        <div className="flex items-center gap-2">
          <Plus className="h-4 w-4 text-white/60" />
          {addLabel}
        </div>
        <Sparkles className="h-4 w-4 text-white/40" />
      </button>
    )
  }

  const renderPaths = () => {
    if (!node.paths || node.paths.length === 0) return null
    return (
      <div className="mt-4 space-y-2">
        {node.paths.map((path) => (
          <div
            key={path.id}
            className={`relative flex items-start gap-3 rounded-2xl border bg-white/5 px-4 py-3 ${toneClasses[path.tone || "default"]}`}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {path.icon && (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 flex-shrink-0">
                    {ICON_REGISTRY[path.icon] || (
                      <span className="text-xs text-white/80 uppercase">
                        {path.icon.slice(0, 2)}
                      </span>
                    )}
                  </span>
                )}
                <p className="text-sm font-semibold text-white">{path.label}</p>
              </div>
              {/* ✅ ONLY SHOW DESCRIPTION FOR AGENTS */}
              {variant === "agent" && (
                path.description ? (
                  <p className="text-xs leading-relaxed text-white/70">{path.description}</p>
                ) : (
                  <PlaceholderText text="Describe when to take this branch." />
                )
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* ✅ Hide inner connection dot ONLY for channel */}
              {variant !== "channel" && variant !== "tool" && (
                <button
                  type="button"
                  data-path-handle={path.id}
                  // ✅ AGENT: BORDER CONNECTION STYLE (POLISHED)
                  className={
                    variant === "agent"
                      ? "absolute -right-1.5 top-1/2 -translate-y-1/2 flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-neutral-900 transition hover:scale-125 z-10"
                      : "flex h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-white/5 transition hover:border-white/40"
                  }
                  style={variant === "agent" ? { background: theme.accent } : undefined}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onPathPointerDown?.(path.id, event)
                  }}
                >
                  {variant !== "agent" && (
                    <span className="h-2 w-2 rounded-full" style={{ background: theme.accent }} />
                  )}
                </button>
              )}

              <button
                type="button"
                className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/70 hover:border-white/30"
                onClick={() => onRemovePath?.(path.id)}
              >
                Remove
              </button>
            </div>
            {path.tone === "warning" && <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-300" />}
          </div>
        ))}
      </div>
    )
  }

  const cardInner = (
    <>
      <div className="flex items-start justify-between">
        <div>
          <div
            className="mb-1 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em]"
            style={{ background: theme.badgeBg, color: theme.badgeText }}
          >
            {badgeLabel}
          </div>
          <h3 className="text-lg font-semibold text-white">{node.name || "Untitled Node"}</h3>
          <p className="text-xs text-white/50">{subtitle}</p>
        </div>
        {variant === "agent" && (
          <div className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1">
            <Sparkles className="h-3 w-3 text-sky-300" />
            <span className="text-[10px] font-medium text-sky-100">
              {node.model || "Gemini 1.5 Pro"}
            </span>
          </div>
        )}
      </div>

      {variant === "agent" && renderAgentSections()}

      {node.paths && node.paths.length > 0 && renderPaths()}

      {/* ✅ REMOVED DESCRIPTION SECTION */}

      {renderAddCard()}
    </>
  )

  return (
    <div
      className="pointer-events-auto select-none border backdrop-blur"
      style={{
        width: CANVAS_NODE_WIDTH,
        borderRadius: CANVAS_NODE_RADIUS,
        padding: "20px",
        background: theme.bg,
        borderColor: selected || focused ? theme.borderActive : theme.border,
        boxShadow: selected || focused ? `0 0 0 2px ${theme.borderActive}` : theme.shadow,
      }}
    >
      {cardInner}
    </div>
  )
}

export default CanvasNodeCard
