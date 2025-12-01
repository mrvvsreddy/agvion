import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { ICON_REGISTRY } from "@/canvas/registry";

interface AddTriggerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (item: { name: string; icon: string; description?: string; provider?: string }) => void;
}

const popularIntegrations = [
  { name: "Webchat", icon: "webchat" },
  { name: "Google Mail", icon: "gmail" },
];

const scheduleOptions = [
  { name: "Daily", interval: "daily" },
  { name: "Weekly", interval: "weekly" },
  { name: "Monthly", interval: "monthly" },
  { name: "Every 10 min", interval: "10min" },
  { name: "Every hour", interval: "hourly" },
  { name: "Custom", interval: "custom" },
];

const IntegrationIcon = ({ type }: { type: string }) => {
  return <>{ICON_REGISTRY[type]}</> || null;
};

export const AddTriggerDialog = ({ open, onOpenChange, onSelect }: AddTriggerDialogProps) => {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredIntegrations = useMemo(() => {
    if (!searchQuery.trim()) return popularIntegrations;
    const query = searchQuery.toLowerCase();
    return popularIntegrations.filter(integration =>
      integration.name.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const filteredSchedule = useMemo(() => {
    if (!searchQuery.trim()) return scheduleOptions;
    const query = searchQuery.toLowerCase();
    return scheduleOptions.filter(option =>
      option.name.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
          <DialogTitle className="text-2xl font-semibold">Add trigger</DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search 1,000+ triggers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-12 text-base"
            />
          </div>

          {/* Most popular */}
          {filteredIntegrations.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Most popular</h3>
              <div className="grid grid-cols-3 gap-3">
                {filteredIntegrations.map((integration) => (
                  <button
                    key={integration.name}
                    className="flex items-center gap-3 p-4 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors text-left"
                    onClick={() => onSelect?.({ name: integration.name, icon: integration.icon })}
                  >
                    <IntegrationIcon type={integration.icon} />
                    <span className="font-medium">{integration.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Schedule */}
          {filteredSchedule.length > 0 && (
            <div className="pb-4">
              <h3 className="text-lg font-semibold mb-4">Schedule</h3>
              <div className="grid grid-cols-3 gap-3">
                {filteredSchedule.map((option) => (
                  <button
                    key={option.interval}
                    className="flex items-center gap-3 p-4 rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors text-left"
                    onClick={() =>
                      onSelect?.({
                        name: option.name,
                        icon: "calendar",
                        description: `Runs ${option.name.toLowerCase()}`,
                      })
                    }
                  >
                    {ICON_REGISTRY.calendar}
                    <span className="font-medium">{option.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filteredIntegrations.length === 0 && filteredSchedule.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No triggers found matching "{searchQuery}"
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
