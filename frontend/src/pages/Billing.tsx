import { CreditCard, MapPin, FileText, Minus, Plus } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const Billing = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const addons = [
    { name: "Table Rows", price: "$25 per 100,000 rows", icon: "📊" },
    { name: "Vector DB Storage", price: "$20 per 1GB of storage", icon: "💾" },
    { name: "Collaborators", price: "$25 per seat", icon: "👥" },
    { name: "Messages & Events", price: "$20 for 5,000 messages per month", icon: "💬" },
    { name: "Always Alive", price: "$10 per bot", icon: "⚡" },
    { name: "File Storage", price: "$10 per 10GB of storage", icon: "📁" },
  ];

  return (
    <div className="flex h-screen bg-background">
      <Sidebar isOpen={sidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        
        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-semibold text-foreground">Billing</h1>

            {/* Current Plan */}
            <div className="bg-muted rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-foreground mb-1">Pay-as-you-go</h2>
                  <p className="text-sm text-muted-foreground">Your current plan</p>
                </div>
                <Button className="bg-foreground text-background hover:bg-foreground/90 cursor-pointer">
                  Manage Plan
                </Button>
              </div>
            </div>

            {/* AI Spend */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">AI Spend</h3>
              <div className="flex items-center gap-4 mb-4">
                <div className="bg-secondary rounded px-3 py-1.5">
                  <span className="text-sm font-medium">$5.00</span>
                </div>
                <span className="text-sm text-muted-foreground">per month</span>
                <Button className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer text-sm h-8 px-3">
                  Update Budget
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                The first $5 each month is free. Usage beyond that is billed at provider cost, with no markup.
              </p>
              <div className="flex items-center justify-between mb-2">
                <div className="h-2 flex-1 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full w-0 bg-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-right">$0.00 of $5.00 used</p>
            </div>

            {/* Add-ons */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold text-foreground mb-6">Add-ons</h3>
              
              <div className="flex gap-4 mb-6 text-sm border-b border-border pb-4">
                <span className="flex-1 text-muted-foreground">Feature</span>
                <span className="w-24 text-center text-muted-foreground">Quantity</span>
                <span className="w-24 text-right text-muted-foreground">Subtotal</span>
              </div>

              <div className="space-y-4">
                {addons.map((addon, index) => (
                  <div key={index} className="flex items-center gap-4">
                    <div className="flex-1 flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center text-lg">
                        {addon.icon}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{addon.name}</p>
                        <p className="text-xs text-muted-foreground">{addon.price}</p>
                      </div>
                    </div>
                    <div className="w-24 flex items-center justify-center gap-2">
                      <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer">
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <span className="text-sm font-medium w-8 text-center">0</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 cursor-pointer">
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <div className="w-24 text-right">
                      <span className="text-sm font-medium">$0</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-6 mt-6 border-t border-border">
                <span className="text-base font-semibold text-foreground">Total cost of Add-ons per month</span>
                <div className="flex items-center gap-4">
                  <Button className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer">
                    Update Add-ons
                  </Button>
                  <span className="text-xl font-bold text-foreground">$0.00</span>
                </div>
              </div>
            </div>

            {/* Upcoming Payment */}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-lg font-semibold text-foreground mb-4">Upcoming Payment</h3>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <p className="text-3xl font-bold text-foreground mb-1">$0.00</p>
                  <p className="text-sm text-muted-foreground">Will be billed on Dec 1, 2025</p>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-gradient-cyan rounded flex items-center justify-center text-xs">💳</div>
                    <span className="text-sm text-foreground">Pay-as-you-go</span>
                  </div>
                  <span className="text-sm font-medium">$0.00</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-accent rounded flex items-center justify-center text-xs">⚡</div>
                    <span className="text-sm text-foreground">AI Spend</span>
                  </div>
                  <span className="text-sm font-medium">$0.00</span>
                </div>
              </div>
            </div>

            {/* Preferences */}
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-4">Preferences</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-card border border-border rounded-lg p-6 cursor-pointer hover:border-border/80 transition-colors">
                  <CreditCard className="w-5 h-5 mb-3 text-foreground" />
                  <h4 className="text-sm font-semibold text-foreground mb-1">Payment Method</h4>
                  <p className="text-xs text-muted-foreground">Add, remove, or update your payment method</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-6 cursor-pointer hover:border-border/80 transition-colors">
                  <MapPin className="w-5 h-5 mb-3 text-foreground" />
                  <h4 className="text-sm font-semibold text-foreground mb-1">Billing Information</h4>
                  <p className="text-xs text-muted-foreground">Edit your name, billing email, address, and tax information</p>
                </div>
                <div className="bg-card border border-border rounded-lg p-6 cursor-pointer hover:border-border/80 transition-colors">
                  <FileText className="w-5 h-5 mb-3 text-foreground" />
                  <h4 className="text-sm font-semibold text-foreground mb-1">Invoice History</h4>
                  <p className="text-xs text-muted-foreground">Download invoices and view your complete billing history</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer">
                Cancel Subscription
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Billing;
