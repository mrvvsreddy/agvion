import { Plus } from "lucide-react";
import AgentCard from "@/components/AgentCard";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";

const Index = () => {
  const [viewMode, setViewMode] = useState<'compact' | 'wide'>('compact');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { workspaceData } = useOutletContext<{ workspaceData: any; loading: boolean }>();

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      {/* Workspace Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-14 h-14 rounded-xl bg-gradient-cyan" />
          <div>
            <h1 className="text-lg font-semibold text-foreground mb-1">
              {workspaceData?.workspace?.name || "Loading..."}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer text-xs h-8 px-3">
            <Plus className="w-3.5 h-3.5 mr-1" />
            Create Agent
          </Button>
        </div>
      </div>

      {/* Agent Cards */}
      <div className={`grid gap-3 ${viewMode === 'compact' ? 'grid-cols-1' : 'grid-cols-1'}`}>
        {workspaceData?.agents && workspaceData.agents.length > 0 ? (
          workspaceData.agents.map((agent: any) => (
            <AgentCard key={agent.id} viewMode={viewMode} agent={agent} />
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No agents found. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;