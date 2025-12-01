export interface AIModel {
    id: string
    name: string
    provider: "OpenAI" | "Anthropic" | "Google" | "Mistral" | "Meta"
    inputCost: string
    outputCost: string
    context: string
    tags: string[]
    description?: string
    icon: string
}

export const AI_MODELS: AIModel[] = [
    {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "OpenAI",
        inputCost: "$5.00",
        outputCost: "$15.00",
        context: "128k",
        tags: ["vision", "reasoning", "fast"],
        description: "Flagship model",
        icon: "openai"
    },
    {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "OpenAI",
        inputCost: "$0.15",
        outputCost: "$0.60",
        context: "128k",
        tags: ["fast", "cheap"],
        description: "Cost-efficient",
        icon: "openai"
    },
    {
        id: "o1-preview",
        name: "o1-preview",
        provider: "OpenAI",
        inputCost: "$15.00",
        outputCost: "$60.00",
        context: "128k",
        tags: ["reasoning", "complex"],
        description: "Advanced reasoning",
        icon: "openai"
    },
    {
        id: "o1-mini",
        name: "o1-mini",
        provider: "OpenAI",
        inputCost: "$3.00",
        outputCost: "$12.00",
        context: "128k",
        tags: ["reasoning", "fast"],
        description: "Fast reasoning",
        icon: "openai"
    },
    {
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
        provider: "Anthropic",
        inputCost: "$3.00",
        outputCost: "$15.00",
        context: "200k",
        tags: ["vision", "coding", "writing"],
        description: "Balanced performance",
        icon: "anthropic"
    },
    {
        id: "claude-3-opus",
        name: "Claude 3 Opus",
        provider: "Anthropic",
        inputCost: "$15.00",
        outputCost: "$75.00",
        context: "200k",
        tags: ["complex", "writing"],
        description: "High intelligence",
        icon: "anthropic"
    },
    {
        id: "claude-3-haiku",
        name: "Claude 3 Haiku",
        provider: "Anthropic",
        inputCost: "$0.25",
        outputCost: "$1.25",
        context: "200k",
        tags: ["fast", "cheap"],
        description: "Speed optimized",
        icon: "anthropic"
    },
    {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        provider: "Google",
        inputCost: "$3.50",
        outputCost: "$10.50",
        context: "2M",
        tags: ["vision", "long-context"],
        description: "Massive context",
        icon: "google"
    },
    {
        id: "gemini-1.5-flash",
        name: "Gemini 1.5 Flash",
        provider: "Google",
        inputCost: "$0.35",
        outputCost: "$1.05",
        context: "1M",
        tags: ["fast", "long-context"],
        description: "High speed",
        icon: "google"
    }
]
