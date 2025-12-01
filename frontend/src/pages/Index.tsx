import { Search, Plus } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import BotCard from "@/components/BotCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import Cookies from 'js-cookie';
import { workspaceService } from "@/services/workspaceService";
const Index = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [viewMode, setViewMode] = useState<'compact' | 'wide'>('compact');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [workspaceData, setWorkspaceData] = useState<any>(null);
  useEffect(() => {
    const fetchWorkspaceData = async () => {
      const workspaceId = Cookies.get('workspaceId');
      if (workspaceId) {
        try {
          // Service call updated to match definition (no args)
          const data = await workspaceService.getWorkspaceData();
          setWorkspaceData(data);
        } catch (error) {
          console.error("Failed to fetch workspace data:", error);
        }
      }
    };
    fetchWorkspaceData();
  }, []);
  return <div className="flex h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />

        <main className="flex-1 overflow-auto">
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
                  Create Bot
                </Button>
              </div>
            </div>

            {/* Search and Filters */}
            

            {/* Bot Cards */}
            <div className={`grid gap-3 ${viewMode === 'compact' ? 'grid-cols-1' : 'grid-cols-1'}`}>
              <BotCard viewMode={viewMode} />
            </div>
          </div>
        </main>
      </div>
    </div>;
};
export default Index;