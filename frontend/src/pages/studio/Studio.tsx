import { useParams, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import StudioHeader from "./StudioHeader";
import StudioSidebar from "./StudioSidebar";
import StudioContent from "./StudioContent";

const Studio = () => {
  const { agentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);

  // Determine if we're on workflow or prompt page
  const isWorkflowPage = location.pathname.includes('/workflow');

  // Redirect /studio/:agentId to /studio/:agentId/prompt
  useEffect(() => {
    if (location.pathname === `/studio/${agentId}`) {
      navigate(`/studio/${agentId}/prompt`, { replace: true });
    }
  }, [location.pathname, agentId, navigate]);

  // Auto-select first workflow when on workflow page with no selection
  useEffect(() => {
    if (isWorkflowPage && !selectedWorkflowId) {
      setSelectedWorkflowId("wf1"); // Default to first workflow
    }
  }, [isWorkflowPage, selectedWorkflowId]);

  // Mock data - replace with actual data fetching
  const agentData = {
    name: "Zara, the Webchat Agent",
    description: "Zara handles customer inquiries through your website's chat widget, providing instant, personalized support.",
    avatar: "",
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <StudioHeader agentName={agentData.name} agentAvatar={agentData.avatar} />
      
      <div className="flex flex-1 overflow-hidden">
        <StudioSidebar 
          onWorkflowSelect={setSelectedWorkflowId}
          selectedWorkflowId={selectedWorkflowId}
        />
        <StudioContent 
          agentName={agentData.name} 
          agentDescription={agentData.description}
          selectedWorkflowId={selectedWorkflowId}
          isWorkflowPage={isWorkflowPage}
        />
      </div>
    </div>
  );
};

export default Studio;
