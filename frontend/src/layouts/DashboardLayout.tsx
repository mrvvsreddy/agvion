import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import { workspaceService } from "@/services/workspaceService";

const DashboardLayout = () => {
    const [sidebarOpen, setSidebarOpen] = useState(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [workspaceData, setWorkspaceData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchWorkspaceData = async () => {
            try {
                const data = await workspaceService.getWorkspaceData();
                setWorkspaceData(data);
            } catch (error) {
                console.error("Failed to fetch workspace data:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchWorkspaceData();
    }, []);

    return (
        <div className="flex h-screen bg-background">
            <Sidebar isOpen={sidebarOpen} workspaceName={workspaceData?.workspace?.name} />

            <div className="flex-1 flex flex-col overflow-hidden">
                <Header
                    onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
                    workspaceName={workspaceData?.workspace?.name}
                    userEmail={workspaceData?.workspace?.email}
                />

                <main className="flex-1 overflow-auto">
                    <Outlet context={{ workspaceData, loading }} />
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
