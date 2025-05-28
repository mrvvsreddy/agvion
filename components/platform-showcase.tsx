"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { MessageSquare, Phone, Camera, Send, Globe } from "lucide-react"
import TypewriterEffect from "./typewriter-effect"
import React from "react"

// Original Platform Icons as SVG components
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893A11.821 11.821 0 0020.484 3.687"/>
  </svg>
)

const FacebookIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
)

const InstagramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
  </svg>
)

const TelegramIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
  </svg>
)

const WebChatIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12c2.54 0 4.894-.79 6.834-2.135l3.166 1.583-1.583-3.166C22.21 16.894 24 14.54 24 12c0-6.627-5.373-12-12-12zm0 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6z"/>
  </svg>
)

const platforms = [
  {
    name: "WhatsApp",
    color: "#25D366",
    icon: WhatsAppIcon,
    description: "Reach 2+ billion users with rich messaging features",
    features: ["Rich media support", "Business API", "Broadcast lists"],
    mockup: {
      bg: "#25D366",
      messages: [
        { text: "Hi! Welcome to our store 👋", sender: "bot" },
        { text: "I'd like to see your products", sender: "user" },
        { text: "Here are our bestsellers! 🛍️", sender: "bot" },
      ],
    },
  },
  {
    name: "Facebook Messenger",
    color: "#0084FF",
    icon: FacebookIcon,
    description: "Connect with customers on the world's largest social platform",
    features: ["Persistent menu", "Quick replies", "Rich cards"],
    mockup: {
      bg: "#0084FF",
      messages: [
        { text: "Hello! How can I help you today?", sender: "bot" },
        { text: "I need support with my order", sender: "user" },
        { text: "I'll help you track your order right away!", sender: "bot" },
      ],
    },
  },
  {
    name: "Instagram",
    color: "#E4405F",
    icon: InstagramIcon,
    description: "Engage with visual content and Stories integration",
    features: ["Story replies", "Visual content", "Shopping tags"],
    mockup: {
      bg: "#E4405F",
      messages: [
        { text: "Love your latest post! 📸", sender: "bot" },
        { text: "Thank you! Can I get more info?", sender: "user" },
        { text: "Here's everything you need to know ✨", sender: "bot" },
      ],
    },
  },
  {
    name: "Telegram",
    color: "#0088CC",
    icon: TelegramIcon,
    description: "Leverage powerful bot features and channels",
    features: ["Inline keyboards", "File sharing", "Group management"],
    mockup: {
      bg: "#0088CC",
      messages: [
        { text: "Welcome to our Telegram bot! 🤖", sender: "bot" },
        { text: "What can you help me with?", sender: "user" },
        { text: "I can help with orders, support, and more!", sender: "bot" },
      ],
    },
  },
  {
    name: "Web Chat",
    color: "#6366F1",
    icon: WebChatIcon,
    description: "Embed directly on your website for seamless support",
    features: ["Custom branding", "File uploads", "Typing indicators"],
    mockup: {
      bg: "#6366F1",
      messages: [
        { text: "Hi there! Need any help browsing our site?", sender: "bot" },
        { text: "Yes, I'm looking for pricing info", sender: "user" },
        { text: "I'll show you our pricing plans right now! 💰", sender: "bot" },
      ],
    },
  },
]

const PlatformShowcase = () => {
  const [currentPlatform, setCurrentPlatform] = useState(0)

  // Handle word change from TypewriterEffect
  const handleWordChange = (wordIndex: number) => {
    setCurrentPlatform(wordIndex)
  }

  const platform = platforms[currentPlatform]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
      {/* Mobile Layout - Content First, Then Mockup */}
      <div className="block lg:hidden">
        {/* Mobile Content */}
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
          <h3 className="font-conthrax text-2xl sm:text-3xl font-bold mb-4 text-center">Automate conversations with AI across</h3>

          {/* Typewriter Effect */}
          <div className="h-12 mb-6 text-center">
            <TypewriterEffect words={platforms.map((p) => p.name)} delay={5000} onWordChange={handleWordChange} />
          </div>

          <p className="font-body text-base text-gray-600 mb-6 leading-relaxed text-center px-2">
            Deploy your AI agents across multiple messaging channels to reach customers wherever they are. Build once,
            deploy everywhere with intelligent automation.
          </p>
        </motion.div>

        {/* Mobile Mockup */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative mb-8"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPlatform}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 1.0 }} // Slower transition to match 5000ms timing
              className="clean-card rounded-2xl overflow-hidden max-w-xs mx-auto"
            >
              {/* Phone Header */}
              <div
                className="h-14 flex items-center justify-between px-4 text-white"
                style={{ backgroundColor: platform.color }}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                    {React.createElement(platform.icon, { className: "w-4 h-4" })}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{platform.name}</div>
                    <div className="text-xs opacity-80">Online</div>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="bg-gray-50 p-3 h-64 overflow-y-auto">
                <div className="space-y-3">
                  {platform.mockup.messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.4 }} // Slower animation to match 5000ms timing
                      className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-xs px-3 py-2 rounded-2xl ${
                          message.sender === "user"
                            ? "bg-blue-500 text-white"
                            : "bg-white border border-gray-200 text-gray-800"
                        }`}
                      >
                        <p className="text-xs">{message.text}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Input Area */}
              <div className="bg-white border-t border-gray-200 p-3">
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-gray-100 rounded-full px-3 py-2">
                    <span className="text-xs text-gray-500">Type a message...</span>
                  </div>
                  <button
                    className="w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: platform.color }}
                  >
                    <MessageSquare className="w-3 h-3 text-white" />
                  </button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Platform Info */}
          <motion.div
            key={`info-${currentPlatform}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }} // Slower transition to match 5000ms timing
            className="mt-4 text-center"
          >
            <h4 className="font-semibold text-base mb-2">{platform.name}</h4>
            <p className="text-gray-600 text-sm mb-3 px-4">{platform.description}</p>
            <div className="flex justify-center space-x-2 text-xs text-gray-500 px-2">
              {platform.features.map((feature, index) => (
                <span key={index} className="bg-gray-100 px-2 py-1 rounded text-xs">
                  {feature}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* Mobile Features List */}
        <ul className="space-y-3 px-4">
          {[
            "No coding required - Visual workflow builder",
            "Advanced natural language understanding",
            "Seamless human handoff when needed",
            "Real-time analytics and insights",
            "Enterprise-grade security",
          ].map((feature, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="flex items-center space-x-3"
            >
              <div className="w-4 h-4 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
              </div>
              <span className="font-body text-gray-700 text-sm">{feature}</span>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* Desktop Layout - Original Two Column */}
      <div className="hidden lg:block">
        {/* Left Side - Content */}
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }}>
          <h3 className="font-conthrax text-3xl font-bold mb-6">Automate conversations with AI across</h3>

          {/* Typewriter Effect */}
          <div className="h-16 mb-8">
            <TypewriterEffect words={platforms.map((p) => p.name)} delay={5000} onWordChange={handleWordChange} />
          </div>

          <p className="font-body text-lg text-gray-600 mb-8 leading-relaxed">
            Deploy your AI agents across multiple messaging channels to reach customers wherever they are. Build once,
            deploy everywhere with intelligent automation.
          </p>

          {/* Features List */}
          <ul className="space-y-3">
            {[
              "No coding required - Visual workflow builder",
              "Advanced natural language understanding",
              "Seamless human handoff when needed",
              "Real-time analytics and insights",
              "Enterprise-grade security",
            ].map((feature, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex items-center space-x-3"
              >
                <div className="w-5 h-5 bg-orange-100 rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                </div>
                <span className="font-body text-gray-700">{feature}</span>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </div>

      <div className="hidden lg:block">
        {/* Right Side - Platform Mockup */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="relative"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPlatform}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 1.0 }} // Slower transition to match 5000ms timing
              className="clean-card rounded-2xl overflow-hidden max-w-sm mx-auto"
            >
              {/* Phone Header */}
              <div
                className="h-16 flex items-center justify-between px-4 text-white"
                style={{ backgroundColor: platform.color }}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
                    {React.createElement(platform.icon, { className: "w-5 h-5" })}
                  </div>
                  <div>
                    <div className="font-semibold">{platform.name}</div>
                    <div className="text-xs opacity-80">Online</div>
                  </div>
                </div>
                <div className="flex space-x-1">
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                  <div className="w-1 h-1 bg-white rounded-full"></div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="bg-gray-50 p-4 h-80 overflow-y-auto">
                <div className="space-y-3">
                  {platform.mockup.messages.map((message, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: index * 0.4 }} // Slower animation to match 5000ms timing
                      className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-xs px-4 py-2 rounded-2xl ${
                          message.sender === "user"
                            ? "bg-blue-500 text-white"
                            : "bg-white border border-gray-200 text-gray-800"
                        }`}
                      >
                        <p className="text-sm">{message.text}</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Input Area */}
              <div className="bg-white border-t border-gray-200 p-3">
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-gray-100 rounded-full px-4 py-2">
                    <span className="text-sm text-gray-500">Type a message...</span>
                  </div>
                  <button
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: platform.color }}
                  >
                    <MessageSquare className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Platform Info */}
          <motion.div
            key={`info-${currentPlatform}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }} // Slower transition to match 5000ms timing
            className="mt-6 text-center"
          >
            <h4 className="font-semibold text-lg mb-2">{platform.name}</h4>
            <p className="text-gray-600 text-sm mb-4">{platform.description}</p>
            <div className="flex justify-center space-x-4 text-xs text-gray-500">
              {platform.features.map((feature, index) => (
                <span key={index} className="bg-gray-100 px-2 py-1 rounded">
                  {feature}
                </span>
              ))}
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

export default PlatformShowcase