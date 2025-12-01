import { useNavigate } from "react-router-dom";
import { Home, Hammer, Play, Share2, Save, ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StudioHeaderProps {
  agentName: string;
  agentAvatar: string;
}

const StudioHeader = ({ agentName, agentAvatar }: StudioHeaderProps) => {
  const navigate = useNavigate();

  return (
    <header className="h-12 border-b border-border bg-background flex items-center justify-between px-4 gap-4">
      {/* Left section */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate("/")}
        >
          <Home className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px] text-white font-bold">Z</span>
          </div>
          <span className="text-sm font-medium text-foreground">{agentName}</span>
        </div>
      </div>

      {/* Center section */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2">
          <Hammer className="h-4 w-4" />
          Build
        </Button>
        <Button variant="outline" size="sm" className="gap-2">
          <Play className="h-4 w-4" />
          Run
        </Button>
      </div>

      {/* Right section */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2">
          <Share2 className="h-4 w-4" />
          Share
        </Button>
        <Button variant="outline" size="sm" className="gap-2" disabled>
          <Save className="h-4 w-4" />
          Save agent
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
};

export default StudioHeader;
