import { Home, Activity, CreditCard, Settings, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLocation, useNavigate } from "react-router-dom";

interface SidebarProps {
  isOpen: boolean;
  workspaceName?: string;
}

const Sidebar = ({
  isOpen,
  workspaceName = "Workspace"
}: SidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [{
    icon: Home,
    label: "Home",
    path: "/"
  }, {
    icon: Activity,
    label: "Usage",
    path: "/usage"
  }, {
    icon: CreditCard,
    label: "Billing",
    badge: "New",
    path: "/billing"
  }, {
    icon: Settings,
    label: "Settings",
    path: "/settings"
  }];

  return (
    <aside className={`bg-sidebar border-r border-sidebar-border flex flex-col h-screen transition-all duration-300 ${isOpen ? 'w-56' : 'w-16'}`}>
      {/* Workspace Header */}
      <div className="h-12 flex items-center px-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2.5 w-full">
          <div className="w-7 h-7 rounded-lg bg-gradient-cyan flex-shrink-0" />
          {isOpen && (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 cursor-pointer">
                <h2 className="text-xs font-medium text-foreground truncate">
                  {workspaceName}
                </h2>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2.5">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.label}>
              <button
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${location.pathname === item.path
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  }`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {isOpen && (
                  <>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge && (
                      <Badge className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0">
                        {item.badge}
                      </Badge>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;