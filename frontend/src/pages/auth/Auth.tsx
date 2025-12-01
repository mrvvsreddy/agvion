import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Eye, EyeOff } from "lucide-react";
import setupGradientBg from "@/assets/setup-gradient-bg.png";
import authService from "@/services/authService";

const emailSchema = z.string().email({ message: "Please enter a valid email address" });
const passwordSchema = z.string().min(8, { message: "Password must be at least 8 characters" });

// Signup flow states
type SignupStep = 'initial' | 'verify-code' | 'create-password';

const Auth = () => {
    const [isLogin, setIsLogin] = useState(false);
    const [isForgotPassword, setIsForgotPassword] = useState(false);
    const [signupStep, setSignupStep] = useState<SignupStep>('initial');
    const [verificationCode, setVerificationCode] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const { toast } = useToast();

    useEffect(() => {
        // Check if user is already logged in
        const checkSession = async () => {
            const token = authService.getSessionToken();
            if (token) {
                try {
                    const result = await authService.validateSession();
                    if (result.success) {
                        const onboardingCompleted = localStorage.getItem('onboarding_completed');
                        if (onboardingCompleted === 'true') {
                            navigate("/");
                        } else {
                            navigate("/setup-workspace");
                        }
                    } else {
                        // Invalid session, clear it
                        authService.clearSession();
                    }
                } catch (error) {
                    authService.clearSession();
                }
            }
        };
        checkSession();
    }, [navigate]);

    const validateEmail = () => {
        try {
            emailSchema.parse(email);
            return true;
        } catch (error) {
            if (error instanceof z.ZodError) {
                setError(error.errors[0].message);
            }
            return false;
        }
    };

    const validatePassword = () => {
        try {
            passwordSchema.parse(password);
            return true;
        } catch (error) {
            if (error instanceof z.ZodError) {
                setError(error.errors[0].message);
            }
            return false;
        }
    };

    const handlePreSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!firstName.trim()) {
            setError("Please enter your first name");
            return;
        }

        if (!validateEmail()) return;

        setIsLoading(true);

        try {
            const name = `${firstName} ${lastName}`.trim();
            const result = await authService.preSignup(email, name);

            if (result.success) {
                toast({
                    title: "Verification code sent",
                    description: "Please check your email for the verification code.",
                });
                setSignupStep('verify-code');
            } else {
                setError(result.message || "Failed to send verification code");
            }
        } catch (err: any) {
            setError(err.message || "Failed to send verification code");
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!verificationCode.trim()) {
            setError("Please enter the verification code");
            return;
        }

        setIsLoading(true);

        try {
            const result = await authService.verifySignup(email, verificationCode);

            if (result.success) {
                toast({
                    title: "Email verified",
                    description: "Now create a password for your account.",
                });
                setSignupStep('create-password');
            } else {
                setError(result.message || "Invalid verification code");
            }
        } catch (err: any) {
            setError(err.message || "Failed to verify code");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCompleteSignup = async (e: React.FormEvent) => {
        if (!validateEmail() || !validatePassword()) return;

        // Navigate to setup workspace with credentials
        // We defer the actual signup (DB creation) until after workspace setup
        navigate("/setup-workspace", {
            state: {
                email,
                password,
                firstName,
                lastName
            }
        });
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!validateEmail() || !validatePassword()) return;

        setIsLoading(true);

        try {
            const result = await authService.login(email, password, false);

            if (result.success && result.sessionToken && result.user) {
                // Store session
                authService.storeSession(result.sessionToken, result.user);

                toast({
                    title: "Welcome back!",
                    description: `Logged in as ${result.user.email}`,
                });

                // Navigate based on onboarding status
                const onboardingCompleted = localStorage.getItem('onboarding_completed');
                if (onboardingCompleted === 'true') {
                    navigate("/");
                } else {
                    navigate("/setup-workspace");
                }
            } else {
                setError(result.message || "Invalid email or password");
            }
        } catch (err: any) {
            setError(err.message || "Login failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");

        if (!validateEmail()) return;

        setIsLoading(true);

        try {
            const result = await authService.requestPasswordReset(email);

            if (result.success) {
                toast({
                    title: "Check your email",
                    description: result.message || "We've sent you a password reset link.",
                });
                setIsForgotPassword(false);
                setEmail("");
            } else {
                setError(result.message || "Failed to send reset email");
            }
        } catch (err: any) {
            setError(err.message || "Failed to send reset email. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendVerification = async () => {
        setIsLoading(true);
        setError("");

        try {
            const name = `${firstName} ${lastName}`.trim();
            const result = await authService.preSignup(email, name);

            if (result.success) {
                toast({
                    title: "Code resent!",
                    description: "We've sent you a new verification code.",
                });
            } else {
                setError(result.message || "Failed to resend code");
            }
        } catch (err: any) {
            setError(err.message || "Failed to resend email. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    const resetSignupFlow = () => {
        setSignupStep('initial');
        setError("");
        setEmail("");
        setPassword("");
        setFirstName("");
        setLastName("");
        setVerificationCode("");
    };

    // Determine which form to show based on state
    const getFormTitle = () => {
        if (isForgotPassword) return "Reset Password";
        if (isLogin) return "Log In Account";
        if (signupStep === 'verify-code') return "Verify Email";
        if (signupStep === 'create-password') return "Create Password";
        return "Sign Up Account";
    };

    const getFormDescription = () => {
        if (isForgotPassword) return "Enter your email to receive a password reset link.";
        if (isLogin) return "Enter your credentials to access your account.";
        if (signupStep === 'verify-code') return "Enter the 6-digit code sent to your email.";
        if (signupStep === 'create-password') return "Choose a strong password for your account.";
        return "Enter your personal data to create your account.";
    };

    const getSubmitHandler = () => {
        if (isForgotPassword) return handleForgotPassword;
        if (isLogin) return handleLogin;
        if (signupStep === 'verify-code') return handleVerifyCode;
        if (signupStep === 'create-password') return handleCompleteSignup;
        return handlePreSignup;
    };

    const getSubmitButtonText = () => {
        if (isLoading) return "Loading...";
        if (isForgotPassword) return "Send Reset Link";
        if (isLogin) return "Log In";
        if (signupStep === 'verify-code') return "Verify Email";
        if (signupStep === 'create-password') return "Create Account";
        return "Sign Up";
    };

    return (
        <div className="min-h-screen flex bg-black p-2.5">
            {/* Left side - Branding with gradient */}
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
                            {isLogin ? "Welcome Back" : "Get Started with Us"}
                        </h1>
                        <p className="text-white/90 text-sm">
                            {isLogin ? "Log in to access your workspace." : "Complete these easy steps to register your account."}
                        </p>
                    </div>

                    {!isLogin ? (
                        <div className="space-y-3">
                            <div className={`flex items-center gap-3 p-4 rounded-[20px] ${signupStep === 'initial' || signupStep === 'verify-code' || signupStep === 'create-password' ? 'bg-white shadow-lg' : 'bg-white/15 backdrop-blur-sm'}`}>
                                <div className={`w-8 h-8 rounded-full ${signupStep === 'initial' || signupStep === 'verify-code' || signupStep === 'create-password' ? 'bg-black text-white' : 'bg-white/25 text-white'} flex items-center justify-center text-sm font-bold flex-shrink-0`}>
                                    1
                                </div>
                                <span className={`font-semibold ${signupStep === 'initial' || signupStep === 'verify-code' || signupStep === 'create-password' ? 'text-gray-900' : 'text-white'} text-sm`}>Sign up your account</span>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-[20px] bg-white/15 backdrop-blur-sm">
                                <div className="w-8 h-8 rounded-full bg-white/25 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                                    2
                                </div>
                                <span className="font-medium text-white text-sm">Set up your workspace</span>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-4 rounded-[20px] bg-white shadow-lg">
                                <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    1
                                </div>
                                <span className="font-semibold text-gray-900 text-sm">Enter your credentials</span>
                            </div>
                            <div className="flex items-center gap-3 p-4 rounded-[20px] bg-white/15 backdrop-blur-sm">
                                <div className="w-8 h-8 rounded-full bg-white/25 text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                                    2
                                </div>
                                <span className="font-medium text-white text-sm">Access your workspace</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right side - Auth Form */}
            <div className="flex-1 flex items-center justify-center p-8 bg-black">
                <div className="w-full max-w-md space-y-5">
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-white mb-1">
                            {getFormTitle()}
                        </h2>
                        <p className="text-gray-400 text-sm">
                            {getFormDescription()}
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-1 duration-300">
                            <p className="text-sm text-red-400">{error}</p>
                        </div>
                    )}

                    <form onSubmit={getSubmitHandler()} className="space-y-5">
                        {!isForgotPassword && !isLogin && signupStep === 'initial' && (
                            <>
                                {/* OAuth Buttons */}
                                <div className="grid grid-cols-2 gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 bg-transparent border border-gray-800 hover:bg-gray-900/50 text-white rounded-xl text-sm"
                                        disabled={isLoading}
                                    >
                                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        Google
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 bg-transparent border border-gray-800 hover:bg-gray-900/50 text-white rounded-xl text-sm"
                                        disabled={isLoading}
                                    >
                                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                        </svg>
                                        Github
                                    </Button>
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-gray-800"></div>
                                    </div>
                                    <div className="relative flex justify-center text-sm">
                                        <span className="px-2 bg-black text-gray-500">Or</span>
                                    </div>
                                </div>
                            </>
                        )}

                        {!isForgotPassword && isLogin && (
                            <>
                                {/* OAuth Buttons for Login */}
                                <div className="grid grid-cols-2 gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 bg-transparent border border-gray-800 hover:bg-gray-900/50 text-white rounded-xl text-sm"
                                        disabled={isLoading}
                                    >
                                        <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                        </svg>
                                        Google
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="h-11 bg-transparent border border-gray-800 hover:bg-gray-900/50 text-white rounded-xl text-sm"
                                        disabled={isLoading}
                                    >
                                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                        </svg>
                                        Github
                                    </Button>
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-gray-800"></div>
                                    </div>
                                    <div className="relative flex justify-center text-sm">
                                        <span className="px-2 bg-black text-gray-500">Or</span>
                                    </div>
                                </div>
                            </>
                        )}

                        <div className="space-y-4">
                            {/* Signup Step 1: Name and Email */}
                            {!isLogin && !isForgotPassword && signupStep === 'initial' && (
                                <>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="firstName" className="text-gray-300 font-normal text-sm">First Name</Label>
                                            <Input
                                                id="firstName"
                                                type="text"
                                                placeholder="eg. John"
                                                value={firstName}
                                                onChange={(e) => setFirstName(e.target.value)}
                                                disabled={isLoading}
                                                required
                                                className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="lastName" className="text-gray-300 font-normal text-sm">Last Name</Label>
                                            <Input
                                                id="lastName"
                                                type="text"
                                                placeholder="eg. Francisco"
                                                value={lastName}
                                                onChange={(e) => setLastName(e.target.value)}
                                                disabled={isLoading}
                                                className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-sm"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="email" className="text-gray-300 font-normal text-sm">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="eg. johnfrans@gmail.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            disabled={isLoading}
                                            className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-sm"
                                        />
                                    </div>
                                </>
                            )}

                            {/* Signup Step 2: Verification Code */}
                            {!isLogin && !isForgotPassword && signupStep === 'verify-code' && (
                                <>
                                    <div className="space-y-2 text-center mb-4">
                                        <p className="text-gray-400 text-sm">
                                            We sent a verification code to
                                        </p>
                                        <p className="text-white font-medium">{email}</p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="code" className="text-gray-300 text-sm">Verification Code</Label>
                                        <Input
                                            id="code"
                                            type="text"
                                            placeholder="Enter 6-digit code"
                                            value={verificationCode}
                                            onChange={(e) => setVerificationCode(e.target.value)}
                                            disabled={isLoading}
                                            className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-center text-lg tracking-widest"
                                            maxLength={6}
                                        />
                                    </div>
                                </>
                            )}

                            {/* Signup Step 3: Create Password */}
                            {!isLogin && !isForgotPassword && signupStep === 'create-password' && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="password" className="text-gray-300 font-normal text-sm">Password</Label>
                                    <div className="relative">
                                        <Input
                                            id="password"
                                            type={showPassword ? "text" : "password"}
                                            placeholder="Enter your password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            disabled={isLoading}
                                            className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 pr-10 rounded-xl text-sm"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500">Must be at least 8 characters.</p>
                                </div>
                            )}

                            {/* Login Form */}
                            {isLogin && !isForgotPassword && (
                                <>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="email" className="text-gray-300 font-normal text-sm">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="eg. johnfrans@gmail.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            disabled={isLoading}
                                            className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="password" className="text-gray-300 font-normal text-sm">Password</Label>
                                        <div className="relative">
                                            <Input
                                                id="password"
                                                type={showPassword ? "text" : "password"}
                                                placeholder="Enter your password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                required
                                                disabled={isLoading}
                                                className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 pr-10 rounded-xl text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                                            >
                                                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500">Must be at least 8 characters.</p>
                                    </div>
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => setIsForgotPassword(true)}
                                            className="text-xs text-gray-400 hover:text-white transition-colors"
                                            disabled={isLoading}
                                        >
                                            Forgot password?
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* Forgot Password Form */}
                            {isForgotPassword && (
                                <div className="space-y-1.5">
                                    <Label htmlFor="email" className="text-gray-300 font-normal text-sm">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="eg. johnfrans@gmail.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                        disabled={isLoading}
                                        className="h-11 bg-[#1a1f2e] border-[#1a1f2e] text-white placeholder:text-gray-600 rounded-xl text-sm"
                                    />
                                </div>
                            )}
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-11 text-sm bg-white text-black hover:bg-gray-100 font-semibold rounded-xl"
                            disabled={isLoading}
                        >
                            {getSubmitButtonText()}
                        </Button>

                        {/* Resend verification button for verify-code step */}
                        {!isLogin && !isForgotPassword && signupStep === 'verify-code' && (
                            <Button
                                type="button"
                                onClick={handleResendVerification}
                                disabled={isLoading}
                                className="w-full h-11 text-sm bg-white/10 text-white hover:bg-white/20 font-semibold rounded-xl border border-white/20"
                            >
                                {isLoading ? "Sending..." : "Resend verification code"}
                            </Button>
                        )}
                    </form>

                    <div className="text-center space-y-2">
                        {isForgotPassword ? (
                            <button
                                type="button"
                                onClick={() => {
                                    setIsForgotPassword(false);
                                    setIsLogin(true);
                                }}
                                className="text-xs text-gray-400 hover:text-white transition-colors"
                                disabled={isLoading}
                            >
                                ← Back to login
                            </button>
                        ) : signupStep !== 'initial' ? (
                            <button
                                type="button"
                                onClick={resetSignupFlow}
                                className="text-xs text-gray-400 hover:text-white transition-colors"
                                disabled={isLoading}
                            >
                                ← Back to signup
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setIsLogin(!isLogin);
                                    setIsForgotPassword(false);
                                    setError("");
                                }}
                                className="text-xs text-gray-400 hover:text-white transition-colors"
                                disabled={isLoading}
                            >
                                {isLogin ? "Don't have an account? " : "Already have an account? "}
                                <span className="text-white font-semibold">
                                    {isLogin ? "Sign up" : "Log in"}
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Auth;
