import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Check, TrendingUp, MessageSquare, Settings, Code, User, Users, UsersRound, Building2, Sprout, Rocket, Zap, Target, Youtube, Instagram, Twitter, Bot, MoreHorizontal } from "lucide-react";
import setupGradientBg from "@/assets/setup-gradient-bg.png";

import { authService } from "@/services/authService";

interface Answer {
    question: string;
    answer: string | string[];
}

const SetupWorkspace = () => {
    const [currentStep, setCurrentStep] = useState(0);
    const [workspaceName, setWorkspaceName] = useState("");
    const [answers, setAnswers] = useState<Answer[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showOtherInput, setShowOtherInput] = useState(false);
    const [otherSource, setOtherSource] = useState("");
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();

    useEffect(() => {
        // Check if user is logged in OR has pending signup credentials
        const token = authService.getSessionToken();
        const hasPendingSignup = location.state?.email && location.state?.password;

        console.log('SetupWorkspace: Checking session:', {
            hasToken: !!token,
            hasPendingSignup: !!hasPendingSignup
        });

        if (!token && !hasPendingSignup) {
            console.log('SetupWorkspace: No token and no pending signup, redirecting to /auth');
            navigate("/auth");
        }
    }, [navigate, location.state]);


    const questions = [
        {
            id: 1,
            question: "What's your workspace name?",
            type: "text" as const,
            placeholder: "eg. My Awesome Workspace",
        },
        {
            id: 2,
            question: "What type of workflows will you build?",
            type: "single" as const,
            options: [
                { label: "Sales & Marketing", icon: TrendingUp, description: "Lead generation, email campaigns, CRM sync" },
                { label: "Customer Support", icon: MessageSquare, description: "Ticket routing, auto-responses, feedback loops" },
                { label: "Operations", icon: Settings, description: "Data sync, reporting, process automation" },
                { label: "Development", icon: Code, description: "CI/CD, deployments, code reviews" },
            ],
        },
        {
            id: 3,
            question: "How big is your team?",
            type: "single" as const,
            options: [
                { label: "Just me", icon: User, description: "Solo entrepreneur or freelancer" },
                { label: "2-10 people", icon: Users, description: "Small team or startup" },
                { label: "11-50 people", icon: UsersRound, description: "Growing company" },
                { label: "50+ people", icon: Building2, description: "Large organization" },
            ],
        },
        {
            id: 4,
            question: "What's your automation experience?",
            type: "single" as const,
            options: [
                { label: "Beginner", icon: Sprout, description: "New to workflow automation" },
                { label: "Intermediate", icon: Rocket, description: "Used tools like Zapier or Make" },
                { label: "Advanced", icon: Zap, description: "Built complex automations before" },
                { label: "Expert", icon: Target, description: "Can code custom integrations" },
            ],
        },
        {
            id: 5,
            question: "How did you hear about us?",
            type: "single" as const,
            options: [
                { label: "ChatGPT", icon: Bot, description: "Found through ChatGPT" },
                { label: "YouTube", icon: Youtube, description: "Discovered on YouTube" },
                { label: "Instagram", icon: Instagram, description: "Saw on Instagram" },
                { label: "X (Twitter)", icon: Twitter, description: "Found on X/Twitter" },
                { label: "Other", icon: MoreHorizontal, description: "Another source" },
            ],
        },
    ];

    const handleTextAnswer = () => {
        if (!workspaceName.trim()) {
            toast({
                variant: "destructive",
                title: "Required Field",
                description: "Please enter your workspace name.",
            });
            return;
        }
        setAnswers([...answers, { question: questions[0].question, answer: workspaceName }]);
        setCurrentStep(1);
    };

    const handleOptionSelect = (option: string) => {
        const currentQuestion = questions[currentStep];

        // If "Other" is selected, show input field
        if (option === "Other") {
            setShowOtherInput(true);
            return;
        }

        setAnswers([...answers, { question: currentQuestion.question, answer: option }]);

        if (currentStep < questions.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            handleFinish(option);
        }
    };

    const handleOtherSourceSubmit = () => {
        if (!otherSource.trim()) {
            toast({
                variant: "destructive",
                title: "Required Field",
                description: "Please enter where you heard about us.",
            });
            return;
        }

        const currentQuestion = questions[currentStep];
        setAnswers([...answers, { question: currentQuestion.question, answer: `Other: ${otherSource}` }]);
        setShowOtherInput(false);
        setOtherSource("");

        if (currentStep < questions.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            handleFinish(`Other: ${otherSource}`);
        }
    };

    const handleFinish = async (lastAnswer: string) => {
        setIsLoading(true);

        try {
            // Prepare onboarding data
            const onboardingData = {
                workspace_name: workspaceName,
                workflow_type: answers.find(a => a.question.includes("workflows"))?.answer as string,
                team_size: answers.find(a => a.question.includes("team"))?.answer as string,
                experience_level: answers.find(a => a.question.includes("experience"))?.answer as string,
                referral_source: lastAnswer,
            };

            // Check if we have pending signup credentials
            if (location.state?.email && location.state?.password) {
                const { email, password } = location.state;

                // Complete signup first
                const signupResult = await authService.completeSignup(email, password);

                if (!signupResult.success || !signupResult.sessionToken || !signupResult.user) {
                    throw new Error(signupResult.message || "Failed to create account");
                }

                // Store session
                authService.storeSession(signupResult.sessionToken, signupResult.user);

                toast({
                    title: "Account created!",
                    description: "Welcome to Agvion.",
                });
            }

            // Save onboarding data via AuthService
            const onboardingResult = await authService.saveOnboardingData(onboardingData);

            // If we have a workspace ID, update the session
            if (onboardingResult.success && onboardingResult.workspaceId) {
                // If we just signed up, we might need to update the stored session with the workspace ID
                const currentUser = authService.getCurrentUser();
                const token = authService.getSessionToken();
                if (currentUser && token) {
                    authService.storeSession(token, currentUser, onboardingResult.workspaceId);
                }
            }

            // Mark onboarding as completed locally
            localStorage.setItem('onboarding_completed', 'true');

            toast({
                title: "Workspace setup complete!",
                description: "You're all set. Let's start building workflows.",
            });

            // Navigate to home
            setTimeout(() => {
                navigate("/");
            }, 1000);
        } catch (error: any) {
            console.error("Error saving onboarding data:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: error.message || "Failed to complete setup. Please try again.",
            });
            setIsLoading(false);
        }
    };

    const handleBack = () => {
        if (showOtherInput) {
            setShowOtherInput(false);
            setOtherSource("");
        } else if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
            setAnswers(answers.slice(0, -1));
        }
    };

    const currentQuestion = questions[currentStep];
    const progress = ((currentStep + 1) / questions.length) * 100;

    return (
        <div className="min-h-screen flex bg-black p-2.5">
            {/* Left side - Progress with gradient */}
            <div className="hidden lg:flex lg:w-1/2 p-12 flex-col justify-center items-center relative overflow-hidden rounded-3xl">
                <div
                    className="absolute inset-0 blur-sm"
                    style={{
                        backgroundImage: `url(${setupGradientBg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                    }}
                />
                <div className="relative z-10 w-full max-w-md space-y-10">
                    <div className="text-center space-y-3">
                        <div className="inline-flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center">
                                <div className="w-4 h-4 rounded-full bg-purple-600" />
                            </div>
                            <span className="text-lg font-bold text-white">Agvion</span>
                        </div>
                        <h1 className="text-3xl font-bold text-white leading-tight">
                            Let's Set Up Your Workspace
                        </h1>
                        <p className="text-white/90 text-sm">
                            Answer a few questions to personalize your experience.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {questions.map((q, index) => {
                            const isCompleted = index < currentStep;
                            const isCurrent = index === currentStep;
                            const isPending = index > currentStep;

                            return (
                                <div
                                    key={q.id}
                                    className={`flex items-center gap-3 p-4 rounded-[20px] transition-all ${isCurrent
                                        ? 'bg-white shadow-lg'
                                        : isCompleted
                                            ? 'bg-white/25 backdrop-blur-sm'
                                            : 'bg-white/10 backdrop-blur-sm'
                                        }`}
                                >
                                    <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isCurrent
                                            ? 'bg-black text-white'
                                            : isCompleted
                                                ? 'bg-green-500 text-white'
                                                : 'bg-white/25 text-white'
                                            }`}
                                    >
                                        {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
                                    </div>
                                    <span
                                        className={`font-semibold text-sm ${isCurrent ? 'text-gray-900' : 'text-white'
                                            }`}
                                    >
                                        {q.question}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Progress bar */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-white/80">
                            <span>Progress</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-white rounded-full transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Right side - Questions */}
            <div className="flex-1 flex items-center justify-center p-8 bg-black">
                <div className="w-full max-w-2xl space-y-6">
                    <div className="text-center mb-8">
                        <span className="text-sm text-gray-500 mb-2 block">
                            Step {currentStep + 1} of {questions.length}
                        </span>
                        <h2 className="text-2xl font-bold text-white mb-2">
                            {currentQuestion.question}
                        </h2>
                    </div>

                    <div className="space-y-4">
                        {showOtherInput ? (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="other-source" className="text-gray-300 font-normal text-sm">
                                        Please specify where you heard about us
                                    </Label>
                                    <Input
                                        id="other-source"
                                        type="text"
                                        placeholder="e.g., Friend, Blog, Podcast..."
                                        value={otherSource}
                                        onChange={(e) => setOtherSource(e.target.value)}
                                        disabled={isLoading}
                                        className="h-12 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-base"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                handleOtherSourceSubmit();
                                            }
                                        }}
                                    />
                                </div>
                                <Button
                                    onClick={handleOtherSourceSubmit}
                                    className="w-full h-12 text-sm bg-white text-black hover:bg-gray-100 font-semibold rounded-xl"
                                    disabled={isLoading}
                                >
                                    Continue
                                </Button>
                            </div>
                        ) : currentQuestion.type === "text" ? (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="workspace-name" className="text-gray-300 font-normal text-sm">
                                        Workspace Name
                                    </Label>
                                    <Input
                                        id="workspace-name"
                                        type="text"
                                        placeholder={currentQuestion.placeholder}
                                        value={workspaceName}
                                        onChange={(e) => setWorkspaceName(e.target.value)}
                                        disabled={isLoading}
                                        className="h-12 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-base"
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                handleTextAnswer();
                                            }
                                        }}
                                    />
                                </div>
                                <Button
                                    onClick={handleTextAnswer}
                                    className="w-full h-12 text-sm bg-white text-black hover:bg-gray-100 font-semibold rounded-xl"
                                    disabled={isLoading}
                                >
                                    Continue
                                </Button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {currentQuestion.options?.map((option) => {
                                    const IconComponent = option.icon;
                                    return (
                                        <button
                                            key={option.label}
                                            onClick={() => handleOptionSelect(option.label)}
                                            disabled={isLoading}
                                            className="group relative p-6 rounded-2xl bg-[#1a1f2e] border-2 border-transparent hover:border-white/20 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <div className="flex items-start gap-4">
                                                <div className="flex-shrink-0 text-white/70">
                                                    <IconComponent className="w-6 h-6" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="text-white font-semibold mb-1 text-base">
                                                        {option.label}
                                                    </h3>
                                                    <p className="text-gray-400 text-xs leading-relaxed">
                                                        {option.description}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="absolute inset-0 rounded-2xl bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {(currentStep > 0 || showOtherInput) && (
                        <div className="flex justify-center pt-4">
                            <button
                                onClick={handleBack}
                                disabled={isLoading}
                                className="text-sm text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                            >
                                ← Go back
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SetupWorkspace;
