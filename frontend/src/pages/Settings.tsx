import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

const Settings = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        
        <main className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-semibold text-foreground">Settings</h1>

            {/* Workspace Settings */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Workspace Settings</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Workspace Name
                  </label>
                  <Input 
                    defaultValue="sankar reddy's Workspace" 
                    className="max-w-md"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Workspace ID
                  </label>
                  <Input 
                    defaultValue="workspace_123456" 
                    className="max-w-md"
                    disabled
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This is your unique workspace identifier
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Plan
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="inline-block px-3 py-1.5 bg-secondary text-foreground text-sm rounded-md">
                      Pay-as-you-go
                    </span>
                    <Button variant="outline" size="sm" className="cursor-pointer">
                      Upgrade Plan
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Settings */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Account Settings</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Email
                  </label>
                  <Input 
                    defaultValue="sankar@example.com" 
                    type="email"
                    className="max-w-md"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground mb-2 block">
                    Password
                  </label>
                  <Button variant="outline" size="sm" className="cursor-pointer">
                    Change Password
                  </Button>
                </div>
              </div>
            </div>

            {/* Notification Settings */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold text-foreground mb-6">Notifications</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Email Notifications</p>
                    <p className="text-xs text-muted-foreground">Receive email updates about your bots</p>
                  </div>
                  <input type="checkbox" defaultChecked className="cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Usage Alerts</p>
                    <p className="text-xs text-muted-foreground">Get notified when reaching usage limits</p>
                  </div>
                  <input type="checkbox" defaultChecked className="cursor-pointer" />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Error Alerts</p>
                    <p className="text-xs text-muted-foreground">Receive alerts when bots encounter errors</p>
                  </div>
                  <input type="checkbox" defaultChecked className="cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="bg-card border border-destructive/50 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-destructive mb-6">Danger Zone</h2>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Delete Workspace</p>
                    <p className="text-xs text-muted-foreground">Permanently delete this workspace and all its data</p>
                  </div>
                  <Button variant="destructive" size="sm" className="cursor-pointer">
                    Delete
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" className="cursor-pointer">Cancel</Button>
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer">
                Save Changes
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Settings;
