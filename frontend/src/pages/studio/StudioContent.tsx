import { useState } from "react";
import { ChevronRight } from "lucide-react";
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
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedName, setEditedName] = useState(agentName);
  const [editedDescription, setEditedDescription] = useState(agentDescription);

  // Mock data for triggers and tools
  const triggers = [
    { id: 1, name: "Gmail", description: "All emails", icon: "gmail" },
    { id: 2, name: "Slack", description: "Messages", icon: "slack" },
  ];

  const tools = [
    { id: 1, name: "Extract Data from PDF", description: "Use this tool to extract specific data points from a PDF file.", icon: "pdf" },
    { id: 2, name: "Send Email", description: "Send emails via SMTP", icon: "email" },
  ];

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

        <div className="flex flex-wrap gap-3">
          {triggers.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Triggers:</span>
              {triggers.slice(0, 3).map((trigger) => (
                <div
                  key={trigger.id}
                  className="flex items-center justify-center w-7 h-7 bg-background border border-border rounded hover:border-primary transition-colors"
                  title={trigger.name}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#4285F4"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                </div>
              ))}
              {triggers.length > 3 && (
                <div className="flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-xs text-muted-foreground">
                  +{triggers.length - 3}
                </div>
              )}
            </div>
          )}

          {tools.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1">Tools:</span>
              {tools.slice(0, 3).map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center justify-center w-7 h-7 bg-background border border-border rounded hover:border-primary transition-colors"
                  title={tool.name}
                >
                  <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" />
                  </svg>
                </div>
              ))}
              {tools.length > 3 && (
                <div className="flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-xs text-muted-foreground">
                  +{tools.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-muted"
          onClick={() => setRightSidebarOpen(true)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
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
