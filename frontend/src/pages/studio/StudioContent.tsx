import { useState } from "react";

import { Button } from "@/components/ui/button";

import CanvasShell from "@/canvas/CanvasShell";
import PromptEditor from "./prompt/PromptEditor";

interface StudioContentProps {
  agentName: string;
  agentDescription: string;
  selectedWorkflowId?: string | null;
  isWorkflowPage?: boolean;
}

const StudioContent = ({ agentName, agentDescription, selectedWorkflowId, isWorkflowPage = false }: StudioContentProps) => {

  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedName, setEditedName] = useState(agentName);
  const [editedDescription, setEditedDescription] = useState(agentDescription);



  const handleNameDoubleClick = () => {
    setIsEditingName(true);
  };

  const handleDescriptionDoubleClick = () => {
    setIsEditingDescription(true);
  };

  const handleNameBlur = () => {
    setIsEditingName(false);
  };

  const handleDescriptionBlur = () => {
    setIsEditingDescription(false);
  };

  const agentHeader = (
    <div className="flex items-start gap-4 mb-6 bg-muted/30 rounded-lg p-4">
      <div
        className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
        onDoubleClick={() => {
          /* Handle image edit */
        }}
        title="Double-click to edit"
      >
        <span className="text-2xl text-white font-bold">Z</span>
      </div>
      <div className="flex-1 min-w-0">
        {isEditingName ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === "Enter" && handleNameBlur()}
            className="text-xl font-semibold text-foreground mb-1 bg-background border border-border rounded px-2 py-1 w-full"
            autoFocus
          />
        ) : (
          <h1
            className="text-xl font-semibold text-foreground mb-1 cursor-pointer hover:text-primary transition-colors"
            onDoubleClick={handleNameDoubleClick}
            title="Double-click to edit"
          >
            {editedName}
          </h1>
        )}

        {isEditingDescription ? (
          <input
            type="text"
            value={editedDescription}
            onChange={(e) => setEditedDescription(e.target.value)}
            onBlur={handleDescriptionBlur}
            onKeyDown={(e) => e.key === "Enter" && handleDescriptionBlur()}
            className="text-sm text-muted-foreground bg-background border border-border rounded px-2 py-1 w-full mb-3"
            autoFocus
          />
        ) : (
          <p
            className="text-sm text-muted-foreground line-clamp-1 mb-3 cursor-pointer hover:text-foreground transition-colors"
            onDoubleClick={handleDescriptionDoubleClick}
            title="Double-click to edit"
          >
            {editedDescription}
          </p>
        )}


      </div>

    </div>
  )

  const renderWorkflowContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        <div className="relative h-full w-full overflow-hidden border-l border-border bg-neutral-950">
          <CanvasShell workflowId={selectedWorkflowId || undefined} />
        </div>
      </div>
    </div>
  )

  const renderPromptContent = () => (
    <div className="max-w-[1200px] mx-auto p-6">
      {agentHeader}
      <PromptEditor />
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden">
      <main className="flex-1 overflow-hidden bg-background">
        {isWorkflowPage && selectedWorkflowId ? renderWorkflowContent() : renderPromptContent()}
      </main>


    </div>
  )
};

export default StudioContent;
