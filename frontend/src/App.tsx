import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "./layouts/DashboardLayout";
import Index from "./pages/Index";
import Usage from "./pages/Usage";
import Billing from "./pages/Billing";
import Settings from "./pages/Settings";
import Studio from "./pages/studio/Studio";
import Auth from "./pages/auth/Auth";
import SetupWorkspace from "./pages/auth/SetupWorkspace";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/setup-workspace" element={<SetupWorkspace />} />
          <Route element={<DashboardLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/home" element={<Index />} />
            <Route path="/usage" element={<Usage />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/studio/:agentId" element={<Studio />} />
          <Route path="/studio/:agentId/prompt" element={<Studio />} />
          <Route path="/studio/:agentId/workflow" element={<Studio />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
