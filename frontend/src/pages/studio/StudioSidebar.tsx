import { useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Sparkles, BookOpen, ChevronsLeft, ChevronsRight, ChevronDown, Folder, Table, Plus } from "lucide-react";

interface StudioSidebarProps {
  onWorkflowSelect?: (workflowId: string) => void;
  selectedWorkflowId?: string | null;
}

const StudioSidebar = ({ onWorkflowSelect, selectedWorkflowId }: StudioSidebarProps) => {
  const navigate = useNavigate();
  const { agentId } = useParams();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedSections, setExpandedSections] = useState<string[]>(["knowledge"]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => 
      prev.includes(section) 
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  return (
    <>
      <aside className={`border-r border-border bg-background flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-[280px]'}`}>
        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto pt-4">
        <ul className="space-y-1">
          {/* Prompt */}
          <li>
            <div 
              onClick={() => navigate(`/studio/${agentId}/prompt`)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                location.pathname.includes('/prompt') 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-foreground hover:bg-muted/50'
              }`}
            >
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">Prompt</div>
                </div>
              )}
            </div>
          </li>

          {/* Knowledge Section */}
          <li>
            <button
              onClick={() => toggleSection("knowledge")}
              className="group w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 rounded-lg transition-colors"
              title={isCollapsed ? "Knowledge" : undefined}
            >
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span>Knowledge</span>}
              </div>
              {!isCollapsed && (
                <div className="flex items-center gap-1">
                  <button 
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle add knowledge folder/file
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections.includes("knowledge") ? "" : "-rotate-90"}`} />
                </div>
              )}
            </button>
            {!isCollapsed && expandedSections.includes("knowledge") && (
              <ul className="space-y-0.5 mt-1 ml-8">
                <li className="group/folder">
                  <div className="flex items-center justify-between">
                    <a className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground text-sm" href="#">
                      <Folder className="w-3.5 h-3.5" />
                      Scenarios
                    </a>
                    <button 
                      className="opacity-0 group-hover/folder:opacity-100 p-1 rounded hover:bg-muted transition-all mr-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle add file to folder
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </li>
                <li className="group/folder">
                  <div className="flex items-center justify-between">
                    <a className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground text-sm" href="#">
                      <Folder className="w-3.5 h-3.5" />
                      Supporting docs
                    </a>
                    <button 
                      className="opacity-0 group-hover/folder:opacity-100 p-1 rounded hover:bg-muted transition-all mr-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle add file to folder
                      }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              </ul>
            )}
          </li>

          {/* Tables Section */}
          <li>
            <button
              onClick={() => toggleSection("tables")}
              className="group w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 rounded-lg transition-colors"
              title={isCollapsed ? "Tables" : undefined}
            >
              <div className="flex items-center gap-3">
                <Table className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span>Tables</span>}
              </div>
              {!isCollapsed && (
                <div className="flex items-center gap-1">
                  <button 
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Handle add table
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <ChevronDown className={`w-4 h-4 transition-transform ${expandedSections.includes("tables") ? "" : "-rotate-90"}`} />
                </div>
              )}
            </button>
            {!isCollapsed && expandedSections.includes("tables") && (
              <ul className="space-y-0.5 mt-1 ml-8">
                <li>
                  <a className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground text-sm" href="#">
                    <Folder className="w-3.5 h-3.5" />
                    Users
                  </a>
                </li>
                <li>
                  <a className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground text-sm" href="#">
                    <Folder className="w-3.5 h-3.5" />
                    Products
                  </a>
                </li>
              </ul>
            )}
          </li>
        </ul>

        {/* Toggle Button at Bottom */}
        <div className="border-t border-border p-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-full flex items-center justify-center p-1.5 rounded hover:bg-muted/50 transition-colors group"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronsRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            ) : (
              <ChevronsLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
          </button>
        </div>
      </nav>
    </aside>
  </>
  );
};

export default StudioSidebar;
