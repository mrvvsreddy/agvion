import { useCallback } from "react"

import { AddTriggerDialog } from "@/components/AddTriggerDialog"
import { AddToolDialog } from "@/components/AddToolDialog"
import useCanvasStore from "@/canvas/store"

const PathDialogHost = () => {
  const pathDialog = useCanvasStore((state) => state.pathDialog)
  const closePathDialog = useCanvasStore((state) => state.closePathDialog)
  const addCustomPathToNode = useCanvasStore((state) => state.addCustomPathToNode)

  const handleSelect = useCallback(
    (payload: { label: string; description?: string; icon?: string; provider?: string; type: "channel" | "tool" }) => {
      if (!pathDialog) return
      addCustomPathToNode(pathDialog.nodeId, {
        label: payload.label,
        description: payload.description,
        icon: payload.icon,
        provider: payload.provider,
        type: payload.type,
      })
      closePathDialog()
    },
    [addCustomPathToNode, closePathDialog, pathDialog],
  )

  if (!pathDialog) return null

  const isChannel = pathDialog.variant === "channel"
  const isTool = pathDialog.variant === "tool"

  return (
    <>
      {isChannel && (
        <AddTriggerDialog
          open
          onOpenChange={(open) => {
            if (!open) closePathDialog()
          }}
          onSelect={(item) =>
            handleSelect({
              label: item.name,
              description: item.description,
              icon: item.icon,
              provider: item.provider,
              type: "channel",
            })
          }
        />
      )}
      {isTool && (
        <AddToolDialog
          open
          onOpenChange={(open) => {
            if (!open) closePathDialog()
          }}
          onSelect={(tool) =>
            handleSelect({
              label: tool.name,
              description: tool.description,
              icon: tool.icon,
              provider: tool.provider,
              type: "tool",
            })
          }
        />
      )}
    </>
  )
}

export default PathDialogHost


