import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const Usage = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        
        <main className="flex-1 overflow-auto">
          <div className="max-w-7xl mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-foreground">Usage</h1>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer">
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-foreground">Nov - 2025</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer">
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer text-sm h-8 px-3 ml-2">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Increase Limits
                </Button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-border">
              <button className="px-4 py-2 text-sm font-medium border-b-2 border-primary text-foreground cursor-pointer">
                Workspace
              </button>
              <button className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
                Bot
              </button>
            </div>

            {/* AI Spend Section */}
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-foreground mb-1">AI Spend</h2>
                  <p className="text-sm text-muted-foreground">
                    Track your usage of third-party AI services here. This meter helps you monitor your spend against your budget.
                  </p>
                </div>
                <div className="flex gap-6 text-right">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Total</p>
                    <p className="text-2xl font-bold text-foreground">$0.08</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Daily Average</p>
                    <p className="text-2xl font-bold text-foreground">$0.01</p>
                  </div>
                </div>
              </div>
              
              {/* Chart placeholder */}
              <div className="h-64 bg-secondary/20 rounded-lg flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Chart visualization</p>
              </div>
            </div>

            {/* Monthly Summary */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">0 of 1</p>
                <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                  <div className="h-full w-0 bg-primary" />
                </div>
                <p className="text-sm font-medium">0%</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">1 of 1</p>
                <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                  <div className="h-full w-full bg-destructive" />
                </div>
                <p className="text-sm font-medium">100%</p>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">0 of 0</p>
                <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                  <div className="h-full w-0 bg-primary" />
                </div>
                <p className="text-sm font-medium">0%</p>
              </div>
            </div>

            {/* Usage Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-base font-semibold text-foreground mb-2">AI Spend</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Track your usage of third-party AI services here. This meter helps you monitor your spend against your budget.
                </p>
                <div className="flex items-center justify-center h-40">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-foreground">$0.25</p>
                    <p className="text-xs text-muted-foreground">of $5.00</p>
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-base font-semibold text-foreground mb-2">Incoming Messages & Events</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Incoming messages and events that trigger bot activation.
                </p>
                <div className="flex items-center justify-center h-40">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-foreground">25</p>
                    <p className="text-xs text-muted-foreground">of 500</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Usage;
