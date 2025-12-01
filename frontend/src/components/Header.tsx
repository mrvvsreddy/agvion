import { PanelLeft, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useLocation } from "react-router-dom";

interface HeaderProps {
  onToggleSidebar: () => void;
}

const Header = ({ onToggleSidebar }: HeaderProps) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const location = useLocation();
  
  const getPageTitle = () => {
    const path = location.pathname;
    if (path === "/") return "Home";
    if (path === "/usage") return "Usage";
    if (path === "/billing") return "Billing";
    if (path === "/settings") return "Settings";
    return "Home";
  };

  return (
    <header className="h-12 border-b border-border bg-background flex items-center justify-between px-4">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-7 w-7 cursor-pointer hover:bg-transparent"
          onClick={onToggleSidebar}
        >
          <PanelLeft className="w-4 h-4" />
        </Button>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>sankar reddy's Workspace</span>
          <span className="text-muted-foreground/50">›</span>
          <span className="text-foreground">{getPageTitle()}</span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1 relative">
        <Button 
          variant="ghost" 
          size="icon" 
          className="relative h-7 w-7 cursor-pointer hover:bg-transparent"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
        </Button>
        
        {/* Notifications Dropdown */}
        {showNotifications && (
          <div className="absolute top-full right-0 mt-2 w-[480px] bg-background border border-border rounded-lg shadow-lg z-50">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">Notifications</h3>
              <div className="flex gap-4">
                <button className="text-sm text-foreground font-medium cursor-pointer hover:text-foreground/80">All</button>
                <button className="text-sm text-muted-foreground cursor-pointer hover:text-foreground">Unread</button>
              </div>
            </div>
            <div className="p-2 space-y-1 max-h-[500px] overflow-y-auto">
              {/* Notification 1 */}
              <div className="p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex-shrink-0" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-purple-600 rounded-full border-2 border-background flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                        <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">Pixelwave <span className="font-normal text-muted-foreground">1h ago</span></p>
                      </div>
                      <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                    </div>
                    <p className="text-sm text-foreground mb-0.5">Commented on <span className="font-semibold">Classic Car in Studio</span></p>
                    <p className="text-xs text-muted-foreground line-clamp-2">These draggable sliders look really cool. Maybe these could be displayed when you hold shift, t...</p>
                  </div>
                </div>
              </div>
              
              {/* Notification 2 */}
              <div className="p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex-shrink-0" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-green-600 rounded-full border-2 border-background flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">Cute Turtle is generated <span className="font-normal text-muted-foreground">1h ago</span></p>
                      </div>
                      <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-0.5">Matte texture - UI8 Style</p>
                    <p className="text-xs text-muted-foreground">Prompt: Create 3D character dancing</p>
                  </div>
                </div>
              </div>

              {/* Notification 3 */}
              <div className="p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex-shrink-0" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-blue-600 rounded-full border-2 border-background flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">3D object is generated <span className="font-normal text-muted-foreground">1h ago</span></p>
                      </div>
                      <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                    </div>
                    <p className="text-sm text-foreground mb-2">Invited you to edit <span className="font-semibold">Minimalist Architecture Scene</span></p>
                    <div className="flex gap-2">
                      <button className="px-4 py-1.5 bg-muted text-foreground text-xs font-medium rounded-md cursor-pointer hover:bg-muted/80 transition-colors">
                        Decline
                      </button>
                      <button className="px-4 py-1.5 bg-foreground text-background text-xs font-medium rounded-md cursor-pointer hover:bg-foreground/90 transition-colors">
                        Accept
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notification 4 */}
              <div className="p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex-shrink-0" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-red-600 rounded-full border-2 border-background flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">Luna <span className="font-normal text-muted-foreground">1h ago</span></p>
                      </div>
                      <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                    </div>
                    <p className="text-sm text-foreground">Liked <span className="font-semibold">Classic Car in Studio</span></p>
                  </div>
                </div>
              </div>

              {/* Notification 5 */}
              <div className="p-3 rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex-shrink-0" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-purple-600 rounded-full border-2 border-background flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                        <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="text-sm font-medium text-foreground">3D object is generated <span className="font-normal text-muted-foreground">1h ago</span></p>
                      </div>
                      <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1.5" />
                    </div>
                    <p className="text-sm text-foreground mb-0.5">Commented on <span className="font-semibold">Classic Car in Studio</span></p>
                    <p className="text-xs text-muted-foreground line-clamp-2">These draggable sliders look really cool. Maybe these could be displayed when you hold shift, t...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-pink-500 to-pink-600 flex items-center justify-center text-xs font-medium ml-2 cursor-pointer">
          S
        </div>
      </div>
    </header>
  );
};

export default Header;
