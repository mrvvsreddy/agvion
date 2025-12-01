import { MessageSquare, AlertCircle, Share2, Edit, MoreVertical, SquarePen, ExternalLink, Zap, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";

interface AgentCardProps {
    viewMode?: 'compact' | 'wide';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agent?: any;
}

const AgentCard = ({
    viewMode = 'compact',
    agent
}: AgentCardProps) => {
    const navigate = useNavigate();

    if (!agent) return null;

    const handleCardClick = () => {
        navigate(`/studio/${agent.id}`);
    };

    const handleOpenStudio = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(`/studio/${agent.id}`);
    };

    // Format date
    const deployedDate = agent.created_at
        ? new Date(agent.created_at).toLocaleDateString()
        : 'Unknown date';

    return (
        <div onClick={handleCardClick} className={`bg-card border border-border rounded-lg p-3 hover:border-border/80 transition-colors cursor-pointer ${viewMode === 'wide' ? 'col-span-2' : ''}`}>
            <div className="flex items-center justify-between">
                {/* Left: Icon and Info */}
                <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0">
                        <MessageSquare className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h3 className="text-sm font-medium text-foreground">{agent.name || 'Unnamed Agent'}</h3>
                        <p className="text-[11px] text-muted-foreground">Created on {deployedDate}</p>
                    </div>
                </div>

                {/* Right: Stats and Actions */}
                <div className="flex items-center gap-4">
                    {/* Stats */}
                    <div className="flex items-center gap-4 border-l border-border pl-4">
                        <div className="flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
                            <div>
                                <div className="text-sm font-semibold text-foreground">0 Requests</div>
                                <div className="text-[10px] text-muted-foreground">No change</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />
                            <div>
                                <div className="text-sm font-semibold text-foreground">0 Errors</div>
                                <div className="text-[10px] text-muted-foreground">No change</div>
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-0.5">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer hover:bg-transparent">
                                    <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <SquarePen className="w-4 h-4 mr-2" />
                                    Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer" onClick={handleOpenStudio}>
                                    <ExternalLink className="w-4 h-4 mr-2" />
                                    Open In Studio
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer">
                                    <Zap className="w-4 h-4 mr-2" />
                                    Enable Always Alive
                                </DropdownMenuItem>
                                <DropdownMenuItem className="cursor-pointer">
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copy to agent
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgentCard;
