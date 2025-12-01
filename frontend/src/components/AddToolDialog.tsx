import { Search, Plus, ChevronDown, Globe, Mail, FileText, Linkedin, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface AddToolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (tool: Tool) => void;
}

interface Tool {
  name: string;
  description: string;
  icon: string;
  provider: string;
  added?: boolean;
}

const allTools: Tool[] = [
  { name: "Perform Google Search", description: "Search Google for information", icon: "google", provider: "Relevance AI" },
  { name: "Extract and Summarize Website Co...", description: "Extract content from websites", icon: "web", provider: "Relevance AI" },
  { name: "Google Search, Scrape and Summar...", description: "Advanced Google search with scraping", icon: "google", provider: "Relevance AI" },
  { name: "Note", description: "Create and manage notes", icon: "note", provider: "Relevance AI" },
  { name: "Google Search", description: "Simple Google search", icon: "google", provider: "Relevance AI" },
  { name: "Send Email via Gmail", description: "Send emails through Gmail", icon: "gmail", provider: "Relevance AI" },
  { name: "RapidAPI - Get a LinkedIn Profile/Co...", description: "Fetch LinkedIn profile data", icon: "linkedin", provider: "Relevance AI" },
  { name: "Extract and Summarize LinkedIn Pro...", description: "Extract LinkedIn profile information", icon: "linkedin", provider: "Relevance AI" },
  { name: "Extract Data from PDF", description: "Extract specific data from PDF files", icon: "pdf", provider: "Relevance AI", added: true },
  { name: "Extract website content", description: "Extract text from web pages", icon: "web", provider: "Relevance AI" },
];

const categories = [
  { name: "All tools", value: "all" },
  { name: "Verified", value: "verified" },
  { name: "Community", value: "community" },
  { name: "API Call", value: "api" },
  { name: "Your tools", value: "your" },
];

const useCases = [
  { name: "Communications", value: "communications" },
  { name: "CRM", value: "crm" },
  { name: "Calendar", value: "calendar" },
];

const ToolIcon = ({ type }: { type: string }) => {
  switch (type) {
    case "google":
      return (
        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center">
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
        </div>
      );
    case "gmail":
      return (
        <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center">
          <Mail className="w-6 h-6 text-red-500" />
        </div>
      );
    case "web":
      return (
        <div className="w-10 h-10 rounded-lg bg-cyan-50 flex items-center justify-center">
          <Globe className="w-6 h-6 text-cyan-600" />
        </div>
      );
    case "note":
      return (
        <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
          <FileText className="w-6 h-6 text-purple-600" />
        </div>
      );
    case "linkedin":
      return (
        <div className="w-10 h-10 rounded-lg bg-blue-500 flex items-center justify-center">
          <Linkedin className="w-5 h-5 text-white" />
        </div>
      );
    case "pdf":
      return (
        <div className="w-10 h-10 rounded-lg bg-red-500 flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z"/>
          </svg>
        </div>
      );
    default:
      return (
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
          <FileText className="w-6 h-6 text-muted-foreground" />
        </div>
      );
  }
};

export const AddToolDialog = ({ open, onOpenChange, onSelect }: AddToolDialogProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return allTools;
    const query = searchQuery.toLowerCase();
    return allTools.filter(tool => 
      tool.name.toLowerCase().includes(query) || 
      tool.description.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] p-0 gap-0">
        {/* Sidebar */}
        <div className="flex h-[90vh]">
          <aside className="w-64 border-r border-border bg-muted/20 flex flex-col">
            <div className="p-4 border-b border-border">
              <DialogTitle className="text-xl font-semibold">Tools</DialogTitle>
            </div>
            
            <div className="p-3 border-b border-border">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search 9,000+ tools..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-10 bg-background"
                />
              </div>
            </div>

            <div className="p-3 border-b border-border">
              <Button variant="ghost" className="w-full justify-between h-10 hover:bg-muted">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  <span>New tool</span>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="p-3">
                <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">Tools</div>
                {categories.map((category) => (
                  <button
                    key={category.value}
                    onClick={() => setSelectedCategory(category.value)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-md text-sm transition-colors mb-1",
                      selectedCategory === category.value 
                        ? "bg-primary/10 text-primary font-medium" 
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    {category.name}
                  </button>
                ))}
              </div>

              <div className="p-3 border-t border-border">
                <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">By use case</div>
                {useCases.map((useCase) => (
                  <button
                    key={useCase.value}
                    className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted text-foreground transition-colors mb-1"
                  >
                    {useCase.name}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 flex flex-col">
            <DialogHeader className="px-6 py-4 border-b border-border">
              <DialogTitle className="text-xl font-semibold">All tools</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">Your tools and tool templates from the community</p>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-4">
                {filteredTools.map((tool, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background hover:bg-muted/30 cursor-pointer transition-colors group relative"
                    onClick={() => onSelect?.(tool)}
                  >
                    <ToolIcon type={tool.icon} />
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm mb-1">{tool.name}</h4>
                      <p className="text-xs text-muted-foreground">by {tool.provider}</p>
                    </div>
                    {tool.added && (
                      <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                        <CheckCircle className="h-3 w-3" />
                        <span>Added</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {filteredTools.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  No tools found matching "{searchQuery}"
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
