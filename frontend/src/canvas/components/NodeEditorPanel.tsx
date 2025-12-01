import React, { useState, useMemo } from "react"
import { X, Settings, Database, Search, Bot } from "lucide-react"
import useCanvasStore, { CanvasNodeVariant } from "@/canvas/store"
import { ICON_REGISTRY } from "@/canvas/registry"
import { cn } from "@/lib/utils"
import { AI_MODELS } from "@/canvas/data/models"

export function NodeEditorPanel() {
    const editingNodeId = useCanvasStore((state) => state.editingNodeId)
    const setEditingNodeId = useCanvasStore((state) => state.setEditingNodeId)
    const nodes = useCanvasStore((state) => state.nodes)
    const updateNode = useCanvasStore((state) => state.updateNode)

    // Auto-select first connected card
    const [selectedCardIndex, setSelectedCardIndex] = useState(0)
    const [showModelSelector, setShowModelSelector] = useState(false)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedProvider, setSelectedProvider] = useState<string>("All Providers")

    // Filter models based on search and provider
    const filteredModels = useMemo(() => {
        return AI_MODELS.filter(model => {
            const matchesSearch = model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                model.provider.toLowerCase().includes(searchQuery.toLowerCase())
            const matchesProvider = selectedProvider === "All Providers" || model.provider === selectedProvider
            return matchesSearch && matchesProvider
        })
    }, [searchQuery, selectedProvider])

    // Get unique providers for dropdown
    const providers = ["All Providers", ...Array.from(new Set(AI_MODELS.map(m => m.provider)))]

    const node = nodes.find((n) => n.id === editingNodeId)

    if (!editingNodeId || !node) return null

    // Get left panel content - only show ACTUALLY connected cards
    const getLeftPanelContent = () => {
        if ((node.variant as CanvasNodeVariant) === "agent") {
            return {
                title: "AGENT CONFIGURATION",
                items: []
            }
        }

        if (node.paths && node.paths.length > 0) {
            return {
                title: "CONNECTED CARDS",
                items: node.paths.map(p => ({ label: p.label, icon: p.icon || "Database" }))
            }
        }

        return {
            title: node.variant === "channel" ? "CHANNEL CONFIGURATION" :
                node.variant === "tool" ? "TOOL CONFIGURATION" : "CONFIGURATION",
            items: []
        }
    }

    const leftPanel = getLeftPanelContent()
    const selectedCard = node.variant !== "agent" ? leftPanel.items[selectedCardIndex] : null

    // Helper to render dynamic icon
    const renderIcon = (iconName: string) => {
        if (ICON_REGISTRY[iconName.toLowerCase()]) {
            return ICON_REGISTRY[iconName.toLowerCase()]
        }
        if (ICON_REGISTRY[iconName]) {
            return ICON_REGISTRY[iconName]
        }

        return <Database className="h-3 w-3" />
    }

    // Helper to get current model details
    const currentModel = AI_MODELS.find(m => m.name === node.model) || AI_MODELS[0]

    return (
        <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-8 animate-in fade-in duration-200"
            onClick={() => setEditingNodeId(null)}
        >
            <div
                className="flex h-full w-full max-w-[1600px] overflow-hidden rounded-2xl border border-neutral-800 bg-[#141414] shadow-2xl ring-1 ring-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                {/* SECTION 1: LEFT PANEL */}
                <div className="flex w-96 flex-col border-r border-neutral-800 bg-[#111111]">
                    <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
                        <div className="flex h-8 items-center">
                            <span className="text-xs font-bold tracking-wider text-neutral-400">{leftPanel.title}</span>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {(node.variant as CanvasNodeVariant) === "agent" ? (
                            <>
                                {/* Agent Name */}
                                <div className="space-y-3">
                                    <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Agent Name</label>
                                    <input
                                        type="text"
                                        value={node.name}
                                        onChange={(e) => updateNode(node.id, (n) => ({ ...n, name: e.target.value }))}
                                        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-white focus:border-neutral-600 focus:outline-none transition-colors"
                                    />
                                </div>

                                {/* Model Selection - Single Button */}
                                <div className="space-y-3">
                                    <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Model</label>
                                    <div
                                        onClick={() => setShowModelSelector(true)}
                                        className="group cursor-pointer rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 transition-all hover:bg-neutral-800 hover:border-neutral-700"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-8 w-8 items-center justify-center rounded bg-neutral-800 text-neutral-400">
                                                {renderIcon(currentModel.icon)}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-sm font-medium text-white">{currentModel.name}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-xs text-neutral-500 mt-0.5">
                                                    <span>{currentModel.context}</span>
                                                    <span>•</span>
                                                    <span>{currentModel.provider}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            // Existing Connected Cards Logic
                            leftPanel.items.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-neutral-500">
                                    <div className="mb-2 rounded-full bg-neutral-800 p-3">
                                        <Search className="h-4 w-4 opacity-50" />
                                    </div>
                                    <p className="text-xs">No cards connected</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {leftPanel.items.map((item, i) => (
                                        <div
                                            key={i}
                                            onClick={() => setSelectedCardIndex(i)}
                                            className={cn(
                                                "group flex cursor-pointer items-center justify-between rounded-md px-3 py-2 transition-colors",
                                                selectedCardIndex === i
                                                    ? "bg-neutral-800 text-white"
                                                    : "hover:bg-neutral-800/50 text-neutral-400"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-neutral-400">
                                                    {renderIcon(item.icon)}
                                                </div>
                                                <span className="text-sm font-medium">{item.label}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* SECTION 2: MAIN CONTENT (Center) */}
                <div className="flex flex-1 flex-col bg-[#141414] overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4 shrink-0">
                        <div className="flex items-center gap-3">
                            {(node.variant as CanvasNodeVariant) === "agent" ? (
                                showModelSelector ? (
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold text-white">AI Models</h2>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                                            <Bot className="h-4 w-4" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-sm font-semibold text-white">{node.name}</h2>
                                            <span className="text-neutral-600">•</span>
                                            <p className="text-xs text-neutral-500 font-mono uppercase">System Prompt</p>
                                        </div>
                                    </>
                                )
                            ) : (
                                <div className="flex items-center gap-3">
                                    <div className={cn(
                                        "flex h-8 w-8 items-center justify-center rounded-lg",
                                        (node.variant as CanvasNodeVariant) === "agent" ? "bg-emerald-500/10 text-emerald-500" :
                                            node.variant === "knowledge" ? "bg-orange-500/10 text-orange-500" :
                                                node.variant === "tool" ? "bg-violet-500/10 text-violet-500" :
                                                    "bg-blue-500/10 text-blue-500"
                                    )}>
                                        {selectedCard ? renderIcon(selectedCard.icon) : <Database className="h-4 w-4" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-sm font-semibold text-white">
                                            {selectedCard ? selectedCard.label : node.name}
                                        </h2>
                                        <span className="text-neutral-600">•</span>
                                        <p className="text-xs text-neutral-500 font-mono uppercase">
                                            {selectedCard ? node.name : node.variant}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-2">
                            {showModelSelector && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setShowModelSelector(false)
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-neutral-800 rounded-md transition-colors mr-2"
                                >
                                    Close <span className="ml-1 opacity-50">Esc</span>
                                </button>
                            )}
                            <button
                                onClick={() => setEditingNodeId(null)}
                                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {(node.variant as CanvasNodeVariant) === "agent" ? (
                            showModelSelector ? (
                                <div className="flex flex-col h-full">
                                    {/* Filters */}
                                    <div className="flex items-center gap-4 p-6 border-b border-neutral-800 shrink-0">
                                        <div className="relative flex-1 max-w-md">
                                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-500" />
                                            <input
                                                type="text"
                                                placeholder="Search models..."
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 pl-10 pr-4 py-2 text-sm text-white focus:border-neutral-700 focus:outline-none"
                                            />
                                        </div>
                                        <select
                                            value={selectedProvider}
                                            onChange={(e) => setSelectedProvider(e.target.value)}
                                            className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm text-neutral-300 focus:border-neutral-700 focus:outline-none"
                                        >
                                            {providers.map(provider => (
                                                <option key={provider} value={provider}>{provider}</option>
                                            ))}
                                        </select>
                                        <div className="flex-1 text-right text-xs text-neutral-500 italic">
                                            Models are billed at provider cost with no markup.
                                        </div>
                                    </div>

                                    {/* Table Header */}
                                    <div className="grid grid-cols-12 gap-4 px-6 py-2 text-[10px] font-medium text-neutral-500 uppercase tracking-wider border-b border-neutral-800 bg-[#141414] shrink-0">
                                        <div className="col-span-4">Name</div>
                                        <div className="col-span-2">Input Cost <span className="text-[9px] normal-case opacity-70 block">Per 1M Tokens</span></div>
                                        <div className="col-span-2">Output Cost <span className="text-[9px] normal-case opacity-70 block">Per 1M Tokens</span></div>
                                        <div className="col-span-1">Context</div>
                                        <div className="col-span-3">Tags</div>
                                    </div>

                                    {/* Table Body - Scrollable */}
                                    <div className="flex-1 overflow-y-auto p-4 space-y-1">
                                        {filteredModels.map((model) => (
                                            <div
                                                key={model.id}
                                                onClick={() => {
                                                    updateNode(node.id, (n) => ({ ...n, model: model.name }))
                                                    setShowModelSelector(false)
                                                }}
                                                className={cn(
                                                    "grid grid-cols-12 gap-4 px-4 py-2.5 rounded-lg cursor-pointer items-center transition-colors",
                                                    node.model === model.name
                                                        ? "bg-blue-500/10 border border-blue-500/20"
                                                        : "hover:bg-neutral-800/50 border border-transparent"
                                                )}
                                            >
                                                <div className="col-span-4 flex items-center gap-2.5">
                                                    <div className={cn(
                                                        "flex h-7 w-7 items-center justify-center rounded-md",
                                                        node.model === model.name ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-400"
                                                    )}>
                                                        {renderIcon(model.icon)}
                                                    </div>
                                                    <div>
                                                        <div className={cn("text-xs font-medium", node.model === model.name ? "text-white" : "text-neutral-200")}>
                                                            {model.name}
                                                        </div>
                                                        <div className="text-[10px] text-neutral-500">{model.provider}</div>
                                                    </div>
                                                    {model.description && (
                                                        <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[9px] font-medium">
                                                            {model.description}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="col-span-2 text-xs text-neutral-300">{model.inputCost}</div>
                                                <div className="col-span-2 text-xs text-neutral-300">{model.outputCost}</div>
                                                <div className="col-span-1 text-xs text-neutral-300">{model.context}</div>
                                                <div className="col-span-3 flex flex-wrap gap-1">
                                                    {model.tags.map(tag => (
                                                        <span key={tag} className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 text-[9px] border border-neutral-700">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col space-y-4 p-6 overflow-hidden">
                                    <div className="flex-1 rounded-xl border border-neutral-800 bg-[#111111] p-4 flex flex-col">
                                        <textarea
                                            className="flex-1 w-full bg-transparent text-sm text-neutral-200 placeholder-neutral-600 focus:outline-none resize-none font-mono leading-relaxed"
                                            placeholder="Enter your system prompt here... Define the agent's persona, constraints, and capabilities."
                                            value={node.prompt || ""}
                                            onChange={(e) => updateNode(node.id, (n) => ({ ...n, prompt: e.target.value }))}
                                        />
                                    </div>
                                    <div className="flex justify-end gap-3 shrink-0">
                                        <div className="text-xs text-neutral-500 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                            Auto-saved
                                        </div>
                                    </div>
                                </div>
                            )
                        ) : (
                            selectedCard ? (
                                <div className="mx-auto max-w-2xl space-y-6 p-6 overflow-y-auto">
                                    {/* Configuration Tip */}
                                    <div className="relative overflow-hidden rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-4">
                                        <div className="flex gap-3">
                                            <div className="mt-0.5 text-indigo-400">
                                                <Settings className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="text-sm font-medium text-indigo-300">Configuration Tip</h4>
                                                <p className="mt-1 text-xs text-indigo-200/70">
                                                    Configure the {selectedCard.label} parameters below. Changes are auto-saved.
                                                </p>
                                            </div>
                                            <button className="text-indigo-400 hover:text-indigo-200"><X className="h-3 w-3" /></button>
                                        </div>
                                    </div>

                                    {/* Form Fields */}
                                    <div className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-neutral-300">
                                                Source for Prompt (User Message)
                                            </label>
                                            <select className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-neutral-500 focus:outline-none">
                                                <option>Connected Chat Trigger Node</option>
                                                <option>Manual Input</option>
                                            </select>
                                        </div>

                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-neutral-300">
                                                Prompt (User Message)
                                            </label>
                                            <div className="relative">
                                                <div className="absolute left-3 top-2.5 flex h-5 w-5 items-center justify-center rounded bg-neutral-700 text-[10px] text-neutral-400 font-mono">fx</div>
                                                <textarea
                                                    className="h-24 w-full rounded-lg border border-neutral-700 bg-neutral-800 pl-10 pr-3 py-2 text-sm text-white font-mono focus:border-neutral-500 focus:outline-none resize-none"
                                                    defaultValue="{{ $json.chatInput }}"
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                                            <span className="text-sm text-neutral-300">Require Specific Output Format</span>
                                            <div className="h-5 w-9 rounded-full bg-neutral-700 p-1 cursor-pointer">
                                                <div className="h-3 w-3 rounded-full bg-neutral-400"></div>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900/50 p-3">
                                            <span className="text-sm text-neutral-300">Enable Fallback Model</span>
                                            <div className="h-5 w-9 rounded-full bg-neutral-700 p-1 cursor-pointer">
                                                <div className="h-3 w-3 rounded-full bg-neutral-400"></div>
                                            </div>
                                        </div>
                                    </div>

                                </div>
                            ) : (
                                <div className="flex h-full items-center justify-center">
                                    <div className="text-center text-neutral-500">
                                        <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
                                        <p className="text-sm">No card selected</p>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
