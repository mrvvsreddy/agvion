import { Plus, Loader2 } from "lucide-react";
import AgentCard from "@/components/AgentCard";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import axios from "axios";
import Cookies from "js-cookie";

// Get API base URL based on environment
const getApiBaseUrl = (): string => {
  const env = import.meta.env.VITE_ENV || 'development';
  if (env === 'production') {
    return import.meta.env.VITE_API_URL_PROD || 'https://api.agvion.com';
  }
  return import.meta.env.VITE_API_URL_DEV || 'http://localhost:3000';
};

const Index = () => {
  const [viewMode, setViewMode] = useState<'compact' | 'wide'>('compact');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { workspaceData } = useOutletContext<{ workspaceData: any; loading: boolean }>();

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) {
      toast({
        title: "Name required",
        description: "Please enter a name for your agent.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    try {
      const token = Cookies.get('sessionToken');
      const baseUrl = getApiBaseUrl();

      const response = await axios.post(`${baseUrl}/api/agents`, {
        name: newAgentName,
        description: `Agent created on ${new Date().toLocaleDateString()}`
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.data.success) {
        toast({
          title: "Agent created",
          description: "Your new agent has been created successfully.",
        });
        setIsCreateDialogOpen(false);
        setNewAgentName("");
        // Navigate to the new agent's studio or refresh the list
        // For now, we'll refresh the page to show the new agent, 
        // ideally we should update the local state or use a query invalidation if using react-query
        window.location.reload();
      }
    } catch (error) {
      console.error("Error creating agent:", error);
      toast({
        title: "Error",
        description: "Failed to create agent. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

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
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer text-xs h-8 px-3"
            onClick={() => setIsCreateDialogOpen(true)}
          >
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

      {/* Create Agent Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Agent</DialogTitle>
            <DialogDescription>
              Give your agent a name to get started. You can configure its personality and knowledge later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="e.g. Customer Support Bot"
                className="col-span-3"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateAgent();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateAgent} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Agent"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;