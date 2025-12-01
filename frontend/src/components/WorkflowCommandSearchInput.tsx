import * as React from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { integrationsRegistry, getIntegrationsByCategory, type Integration } from '@/lib/integrations-registry';
import { Search as SearchIcon, Workflow, Settings } from 'lucide-react';

export interface WorkflowCommandSearchInputProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onIntegrationSelect?: (integration: Integration) => void;
}

export function WorkflowCommandSearchInput({
  open = false,
  onOpenChange,
  onIntegrationSelect,
}: WorkflowCommandSearchInputProps) {
  const [isOpen, setIsOpen] = React.useState(open);
  const [searchQuery, setSearchQuery] = React.useState('');

  React.useEffect(() => {
    setIsOpen(open);
  }, [open]);

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen((open) => !open);
        onOpenChange?.(!isOpen);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, onOpenChange]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
    if (!open) {
      setSearchQuery('');
    }
  };

  const handleSelect = (integration: Integration) => {
    onIntegrationSelect?.(integration);
    handleOpenChange(false);
  };

  const filteredIntegrations = React.useMemo(() => {
    if (!searchQuery.trim()) return integrationsRegistry;
    const query = searchQuery.toLowerCase();
    return integrationsRegistry.filter(
      (integration) =>
        integration.name.toLowerCase().includes(query) ||
        integration.category.toLowerCase().includes(query) ||
        integration.description?.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const groupedIntegrations = React.useMemo(() => {
    const groups: Record<string, Integration[]> = {};
    filteredIntegrations.forEach((integration) => {
      if (!groups[integration.category]) {
        groups[integration.category] = [];
      }
      groups[integration.category].push(integration);
    });
    return groups;
  }, [filteredIntegrations]);

  const categoryLabels: Record<string, string> = {
    communication: 'Communication',
    productivity: 'Productivity',
    crm: 'CRM',
    database: 'Database',
    analytics: 'Analytics',
    social: 'Social Media',
    development: 'Development',
    automation: 'Automation',
  };

  return (
    <CommandDialog open={isOpen} onOpenChange={handleOpenChange}>
      <CommandInput 
        placeholder="Type a command or search..." 
        value={searchQuery}
        onValueChange={setSearchQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Object.entries(groupedIntegrations).map(([category, integrations]) => (
          <CommandGroup key={category} heading={categoryLabels[category] || category}>
            {integrations.map((integration) => {
              const Icon = integration.icon;
              return (
                <CommandItem
                  key={integration.id}
                  onSelect={() => handleSelect(integration)}
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 h-4 w-4" style={{ color: integration.color }} />
                  <span>{integration.name}</span>
                  {integration.description && (
                    <span className="ml-auto text-xs text-muted-foreground hidden sm:inline">
                      {integration.description.slice(0, 30)}...
                    </span>
                  )}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem className="cursor-pointer">
            <SearchIcon className="mr-2 h-4 w-4" />
            <span>Search Nodes</span>
            <span className="ml-auto text-xs text-muted-foreground">⌘K</span>
          </CommandItem>
          <CommandItem className="cursor-pointer">
            <Workflow className="mr-2 h-4 w-4" />
            <span>Save Workflow</span>
            <span className="ml-auto text-xs text-muted-foreground">⌘S</span>
          </CommandItem>
          <CommandItem className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            <span>Workflow Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default WorkflowCommandSearchInput;

