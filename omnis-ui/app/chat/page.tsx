"use client";

import { useState, useEffect, useRef, Suspense, useMemo } from "react";
import { Mic, ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useInitialPrompt } from "@/hooks/useInitialPrompt";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-provider";
import { useLettaChat } from "@/lib/mock-letta-chat-provider";
import { ChatDashboard } from "@/components/measles-dashboard/chat-dashboard";
import { TVGChatDashboard } from "@/components/tvg-dashboard/tvg-chat-dashboard";
import { ESGChatProvider } from "@/components/esg-chat-provider";
import { ESGChatDashboard } from "@/components/esg-dashboard/chat-dashboard";
import { ESGDAGVisualization } from "@/components/esg-dag-visualization";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VideoPopup } from "@/components/VideoPopup";
import { useVideoSettings } from "@/lib/video-settings-provider";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { clearDAGMemory } from "@/components/dag/visualization";

// Dynamically import the DAG component to avoid SSR issues with ReactFlow
const DAGVisualization = dynamic(
  () => import("@/components/dag").then((mod) => mod.DAGVisualization),
  { ssr: false }
);



export default function ChatPage() {
  const { initialPrompt, clearInitialPrompt } = useInitialPrompt();
  const { user } = useAuth();
  const { isVideoEnabled } = useVideoSettings();
  const [inputValue, setInputValue] = useState("");
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("Chat"); // Track active tab
  const [showNewMessageAnimation, setShowNewMessageAnimation] = useState(false);
  const [initialPromptProcessed, setInitialPromptProcessed] = useState(false);

  // Add states for dashboard tracking
  const [dashboardLoadingState, setDashboardLoadingState] = useState<{
    [key: string]: boolean;
  }>({});
  const [dashboardLoaded, setDashboardLoaded] = useState<
    Record<string, boolean>
  >({});
  // Track whether tab switching occurred to avoid reloading when just switching tabs
  const [tabSwitched, setTabSwitched] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Add a ref to keep track of already loaded dashboards
  const loadedDashboardsRef = useRef<Set<string>>(new Set());
  // Add a dedicated state for tracking first-render loading state
  const [initialRender, setInitialRender] = useState(true);

  const router = useRouter();

  // Use the Letta chat context
  const { messages, sendMessage, streaming, resetChat, agentId } =
    useLettaChat();

  // Response templates
  const defaultResponse = `Following the surge in hospital visits after the major public event in UAE, our analysis has revealed several important patterns and potential risk factors. The findings suggest targeted interventions may be required in specific regions.

1. Key Health Metrics
Analysis of data collected from health facilities across the country shows a 28% increase in respiratory complaints in the three days following the event. This is particularly pronounced in the northern emirates where attendance was highest.
• Infection Rate Spike: 18% increase over the baseline in Abu Dhabi and 23% in Dubai.
• Vaccination Coverage: Areas with lower vaccination rates showed 3.2x higher hospitalization rates.
• Demographic Distribution: 62% of cases were in the 20-40 age group, correlating with event attendance demographics.`;

  // Create a deduplicated array of messages for rendering
  const deduplicatedMessages = useMemo(() => {
    const uniqueMessageIds = new Set();
    return messages.filter((message) => {
      if (uniqueMessageIds.has(message.id)) {
        return false;
      }
      uniqueMessageIds.add(message.id);
      return true;
    });
  }, [messages]);

  // Get the latest query from messages
  const latestQuery = useMemo(() => {
    // Find the last user message
    for (let i = deduplicatedMessages.length - 1; i >= 0; i--) {
      if (deduplicatedMessages[i].role === "user") {
        return deduplicatedMessages[i].content;
      }
    }
    return initialPrompt || "Chat";
  }, [deduplicatedMessages, initialPrompt]);

  // For tracking when a new user message is sent
  const [newMessageSent, setNewMessageSent] = useState(false);

  // Create a ref to the latest message section
  const latestMessageRef = useRef<HTMLDivElement>(null);

  // Add a useEffect to track health prompts we've already seen
  const seenHealthPromptsRef = useRef<Set<string>>(new Set());


  // Add state for measles video popup
  const [showMeaslesVideoPopup, setShowMeaslesVideoPopup] = useState(false);
  // Add state for chat output video popup
  const [showChatOutputVideoPopup, setShowChatOutputVideoPopup] =
    useState(false);
  // Add states to track DAG and video completion PER MESSAGE
  const [dagCompleted, setDagCompleted] = useState(false);
  const [videoWatched, setVideoWatched] = useState(false);
  const [lastCompletedMessageId, setLastCompletedMessageId] =
    useState<string>("");
  
  // NEW: Track completed DAGs per message ID to persist completion state
  const [completedDAGsByMessage, setCompletedDAGsByMessage] = useState<Record<string, boolean>>({});
  const [completedDashboardsByMessage, setCompletedDashboardsByMessage] = useState<Record<string, boolean>>({});

  // Handle clearing conversation
  const handleClearConversation = async () => {
    if (confirm("Are you sure you want to clear the conversation history?")) {
      try {
        await resetChat();
        console.log("Conversation history cleared successfully");
      } catch (error) {
        console.error("Error clearing conversation history:", error);
        alert("Failed to clear conversation history. See console for details.");
      }
    }
  };

  // Define processInitialPrompt function before using it in useEffect
  const processInitialPrompt = async () => {
    // Only proceed if we have an agent, a prompt, AND we haven't processed it yet
    if (agentId && initialPrompt && !initialPromptProcessed) {
      // Mark as processed immediately to prevent re-entry
      setInitialPromptProcessed(true);

      console.log(
        `Processing initial prompt for agent ${agentId}: ${initialPrompt.substring(
          0,
          30
        )}...`
      );

      // Check if it's a health-related, Isuzu-related, or ESG-related message
      const isHealth = isHealthPrompt(initialPrompt);
      const isIsuzu = isIzuzuPrompt(initialPrompt);
      const isESG = isESGPrompt(initialPrompt);

      // Clear any cached DAG state for fresh execution of initial prompt
      if (isHealth || isIsuzu || isESG) {
        const workflowType = isHealth ? "health" : isIsuzu ? "isuzu" : "esg";
        console.log(`Initial prompt: Clearing cached DAG state for ${workflowType} workflow to ensure fresh execution`);
        
        if (isESG) {
          // For ESG, clear any DAG that starts with "esg-dag-"
          const storedDAGs = localStorage.getItem("omnis_completed_dags");
          if (storedDAGs) {
            try {
              const completedDAGs = JSON.parse(storedDAGs);
              const filteredDAGs = completedDAGs.filter((id: string) => !id.startsWith("esg-dag-"));
              localStorage.setItem("omnis_completed_dags", JSON.stringify(filteredDAGs));
              console.log("Initial prompt: Cleared all ESG DAG cache entries for fresh execution");
            } catch (e) {
              console.error("Error clearing ESG DAG cache on initial prompt:", e);
            }
          }
        }
      }

      // Send the initial prompt
      try {
        const success = await sendMessage(initialPrompt);
        console.log("Initial prompt sent, result:", success);

        // If health-related, Isuzu-related, or ESG-related and successful, switch to DAG tab with a delay
        if (success && (isHealth || isIsuzu || isESG)) {
          console.log("Health/Isuzu/ESG-related initial prompt, switching to DAG tab");
          setTimeout(() => {
            setActiveTab("DAG");
          }, 800);
        }

        if (success) {
          console.log("Initial prompt sent successfully, clearing...");
          clearInitialPrompt();
        } else {
          console.warn(
            "Initial prompt sending failed. You may need to resend your message."
          );
          clearInitialPrompt(); // Still clear to prevent getting stuck
        }
      } catch (error: any) {
        console.error("Error sending initial prompt:", error);
        clearInitialPrompt(); // Still clear to prevent getting stuck
      }
    }
  };

  // Use the initial prompt if available and agent is ready
  useEffect(() => {
    processInitialPrompt();
  }, [
    agentId,
    initialPrompt,
    initialPromptProcessed,
    sendMessage,
    clearInitialPrompt,
  ]);

  // Separate useEffect for redirecting if no agent/prompt (to avoid complexity)
  useEffect(() => {
    // Give some time for agentId and initialPrompt to potentially load
    const redirectTimeout = setTimeout(() => {
      const hasServerError =
        typeof window !== "undefined" &&
        localStorage.getItem("letta_server_error") === "true";

      // Redirect if: No agent, no messages yet, no initial prompt trying to load, and no server error
      if (
        !agentId &&
        messages.length === 0 &&
        !initialPrompt &&
        !hasServerError
      ) {
        console.log(
          "No agent, messages, or initial prompt found after delay. Redirecting to /prompt."
        );
        router.push("/prompt");
      }
    }, 1500); // Increased delay slightly to ensure states stabilize

    return () => clearTimeout(redirectTimeout);
  }, [agentId, messages.length, initialPrompt, router]);

  // First effect just detects initial prompt and sets a flag
  useEffect(() => {
    if (initialPrompt) {
      console.log("Initial prompt detected, checking if it's a health prompt");
      // Reset completion tracking
      setDagCompleted(false);
      setVideoWatched(false);

      // Only show measles video if it's a health prompt and enabled in settings
      const isHealth = isHealthPrompt(initialPrompt);
      // if (isHealth && isVideoEnabled("measles")) {
      //   console.log("Health prompt detected, showing measles video");
      //   setShowMeaslesVideoPopup(true);
      // } else {
        // Mark as watched if disabled or not a health prompt
        setVideoWatched(true);
      // } // DISABLED: Video popup deactivated
    }
  }, [initialPrompt, isVideoEnabled]);

  // Track scroll position and update header state
  useEffect(() => {
    // Only track scroll position for header animation
    const handleScroll = () => {
      const scrollThreshold = 20;
      const maxScrollEffect = 80;

      const scrollTop = window.scrollY;
      setIsScrolled(scrollTop > scrollThreshold);

      const progress = Math.min(
        (scrollTop - scrollThreshold) / (maxScrollEffect - scrollThreshold),
        1
      );
      setScrollProgress(scrollTop <= scrollThreshold ? 0 : progress);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Update the header title when the latest query changes
  useEffect(() => {
    if (latestQuery && headerRef.current) {
      // Apply animation to header when title changes
      headerRef.current.classList.add("animate-title-change");
      setTimeout(() => {
        if (headerRef.current) {
          headerRef.current.classList.remove("animate-title-change");
        }
      }, 500);
    }
  }, [latestQuery]);

  // Calculate transform based on scroll progress
  const headerTransform = `translateY(-${scrollProgress * 12}px)`;
  const titleScale = 1 - scrollProgress * 0.3; // Reduce title size smoothly
  const titleBottomMargin = 16 - scrollProgress * 6;
  const tabsTransform = `translateY(-${scrollProgress * 6}px)`;

  // Add useEffect to check for preferred tab when component mounts
  useEffect(() => {
    // Check if there's a stored preference in localStorage
    const preferredTab = localStorage.getItem("preferredTab");
    if (preferredTab) {
      console.log(`Setting active tab from localStorage: ${preferredTab}`);
      setActiveTab(preferredTab);
      // Set tabSwitched to true to prevent reloading dashboards
      setTabSwitched(true);
      // Clear the preference after using it
      localStorage.removeItem("preferredTab");
    }
  }, []);

  // Handle tab click - PRESERVE completion state when switching tabs
  const handleTabClick = (tabName: string) => {
    console.log(`Tab clicked: ${tabName}`);
    setActiveTab(tabName);
    setTabSwitched(true);

    // DO NOT reset DAG completion state when switching tabs
    // This allows dashboards to persist when switching between Chat and DAG tabs
    console.log(`Tab switched to ${tabName} - preserving completion state`);
  };

  // Reset tab switch flag when a new message is sent
  useEffect(() => {
    if (deduplicatedMessages.length > 0) {
      setTabSwitched(false);
    }
  }, [deduplicatedMessages.length]);

  // Update the dashboard loading state management to handle both initial and follow-up messages properly
  useEffect(() => {
    // Process all health-prompt messages but be smart about loading states
    deduplicatedMessages.forEach((msg, idx) => {
      // Only interested in assistant messages (responses)
      if (msg.role === "assistant" && idx > 0) {
        // Get the corresponding user message
        const userMsg = deduplicatedMessages[idx - 1];

        // Check if the user message is a health prompt
        if (userMsg.role === "user" && isHealthPrompt(userMsg.content)) {
          const msgId = msg.id;

          // Is this a new dashboard we haven't processed yet?
          if (
            !loadedDashboardsRef.current.has(msgId) &&
            dashboardLoadingState[msgId] === undefined
          ) {
            console.log(
              `NEW dashboard detected for message ${msgId.substring(
                0,
                8
              )} - setting loading state`
            );

            // Set loading state to true for this specific message
            setDashboardLoadingState((prev) => ({
              ...prev,
              [msgId]: true,
            }));

            // Start timer to turn off loading
            setTimeout(() => {
              console.log(
                `Loading COMPLETE for dashboard at message ${msgId.substring(
                  0,
                  8
                )}`
              );

              // Update dashboard loading state
              setDashboardLoadingState((prev) => ({
                ...prev,
                [msgId]: false,
              }));

              // Set this dashboard as loaded so we can avoid the loading state when switching tabs
              setDashboardLoaded((prev) => ({
                ...prev,
                [msgId]: true,
              }));

              // Add to set of loaded dashboards so we don't reload it
              loadedDashboardsRef.current.add(msgId);
            }, 4000);
          }
        }
      }
    });
  }, [deduplicatedMessages]);

  // Add a useEffect for global debug
  useEffect(() => {
    // Log the state of all messages for debug purposes
    if (deduplicatedMessages.length > 0) {
      console.log("CRITICAL DEBUG - All messages:");
      deduplicatedMessages.forEach((msg, idx) => {
        console.log(`[${idx}] ${msg.role}: ${msg.content.substring(0, 50)}...`);
      });
    }
  }, [deduplicatedMessages]);

  // Helper functions to identify prompt types
  const isHealthPrompt = (content: string) => {
    const HEALTH_CASE_PROMPT =
      "Show today's autonomous truck performance with insights from Gatik, NVIDIA, and Applied Intuition.";

    const exactMatch = content.trim() === HEALTH_CASE_PROMPT.trim();
    const partialMatch =
      content.toLowerCase().includes("autonomous truck") &&
      content.toLowerCase().includes("performance") &&
      (content.toLowerCase().includes("gatik") ||
       content.toLowerCase().includes("nvidia") ||
       content.toLowerCase().includes("applied intuition"));

    const result = exactMatch || partialMatch;
    console.log(
      `HEALTH CHECK: "${content.substring(0, 30)}..." - Result: ${
        result ? "YES" : "NO"
      }`
    );
    return result;
  };

  const isIzuzuPrompt = (content: string) => {
    const ISUZU_CASE_PROMPT =
      "Show me productivity and sustainability insights for the Isuzu pickup.";

    const exactMatch = content.trim() === ISUZU_CASE_PROMPT.trim();
    const partialMatch =
      content.toLowerCase().includes("isuzu") &&
      content.toLowerCase().includes("pickup") &&
      (content.toLowerCase().includes("productivity") ||
       content.toLowerCase().includes("sustainability"));

    const result = exactMatch || partialMatch;
    console.log(
      `ISUZU CHECK: "${content.substring(0, 30)}..." - Result: ${
        result ? "YES" : "NO"
      }`
    );
    return result;
  };

  const isBackToSchoolPrompt = (content: string) => {
    const BACK_TO_SCHOOL_PROMPT =
      "What's the best way to increase attach rate for Back-to-School customers like Emily, while reducing WISMO contact volume over the next 4 weeks?";

    const exactMatch = content.trim() === BACK_TO_SCHOOL_PROMPT.trim();
    const partialMatch =
      content.toLowerCase().includes("back-to-school") &&
      content.toLowerCase().includes("attach rate") &&
      content.toLowerCase().includes("emily") &&
      content.toLowerCase().includes("wismo");

    const result = exactMatch || partialMatch;
    console.log(
      `BACK-TO-SCHOOL CHECK: "${content.substring(0, 30)}..." - Result: ${
        result ? "YES" : "NO"
      }`
    );
    return result;
  };

  const isESGPrompt = (content: string) => {
    const ESG_KEYWORDS = [
      "esg", "environmental", "social", "governance", 
      "portfolio", "sustainability", "carbon", "climate",
      "regulatory", "compliance", "sfdr", "tcfd",
      "emissions", "scope 3", "financed emissions", "investments",
      "category 15", "supply chain"
    ];

    const lowerContent = content.toLowerCase();
    const hasESGKeywords = ESG_KEYWORDS.some(keyword => 
      lowerContent.includes(keyword)
    );

    // Specific ESG analysis patterns
    const isESGAnalysis = 
      (lowerContent.includes("portfolio") && (lowerContent.includes("esg") || lowerContent.includes("sustainability"))) ||
      (lowerContent.includes("climate") && lowerContent.includes("risk")) ||
      (lowerContent.includes("esg") && (lowerContent.includes("score") || lowerContent.includes("analysis"))) ||
      (lowerContent.includes("regulatory") && lowerContent.includes("compliance")) ||
      (lowerContent.includes("emissions") && (lowerContent.includes("scope") || lowerContent.includes("carbon"))) ||
      (lowerContent.includes("financed emissions") || lowerContent.includes("category 15")) ||
      (lowerContent.includes("investments") && (lowerContent.includes("emissions") || lowerContent.includes("esg") || lowerContent.includes("sustainability")));

    const result = hasESGKeywords && isESGAnalysis;
    console.log(
      `ESG CHECK: "${content.substring(0, 30)}..." - Result: ${
        result ? "YES" : "NO"
      }`
    );
    return result;
  };

  // Handle DAG completion with persistent state per message
  const handleDAGCompletion = (section: number, messageId: string) => {
    console.log(
      `DAG workflow completed for section ${section}, messageId ${messageId} - persisting completion state`
    );

    // Mark DAG as completed globally AND per message
    setDagCompleted(true);
    setLastCompletedMessageId(messageId);
    
    // PERSIST completion state per message - this prevents reset on tab switching
    setCompletedDAGsByMessage(prev => ({
      ...prev,
      [messageId]: true
    }));

    // Store this health messageId to prevent re-processing
    seenHealthPromptsRef.current.add(messageId);

    console.log(`DAG completion persisted for message ${messageId} - dashboard will remain available`);

    // Only switch to Chat tab if measles video is not showing or has been watched
    if (!showMeaslesVideoPopup || videoWatched) {
      console.log("Video already completed, switching to Chat tab");

      // Show chat output video when switching to chat tab (if enabled)
      // if (isVideoEnabled("chatOutput")) {
      //   setShowChatOutputVideoPopup(true);
      // } // DISABLED: Video popup deactivated

      setActiveTab("Chat");
    } else {
      console.log("Waiting for video to complete before switching to Chat tab");
    }
  };

  // Update the renderChatSections function to use the dashboardLoaded state
  const renderChatSections = () => {
    const sections = [];

    // Process sections in chronological order (oldest to newest)
    for (let i = 0; i < deduplicatedMessages.length; i += 2) {
      const userMessage = deduplicatedMessages[i];
      const assistantMessage =
        i + 1 < deduplicatedMessages.length
          ? deduplicatedMessages[i + 1]
          : null;

      const sectionIndex = Math.floor(i / 2);
      const messageId = assistantMessage?.id || "";
      const userMessageId = userMessage?.id || "";

      // Check if this is the latest user message
      const isLatestSection =
        i === deduplicatedMessages.length - 2 ||
        (i === deduplicatedMessages.length - 1 && !assistantMessage);

      // Check if this is the latest section (new message)
      const isNewMessage = isLatestSection && !tabSwitched;

      if (userMessage && userMessage.role === "user") {
        sections.push(
          <div
            key={userMessage.id}
            className={`message-section ${
              isLatestSection && showNewMessageAnimation ? "animate-fadeIn" : ""
            }`}
            id={`section-${sectionIndex}`}
            ref={isLatestSection ? latestMessageRef : null}
            data-is-latest={isLatestSection ? "true" : "false"} // Add data attribute for debugging
          >
            {/* Section header styled exactly like the main header */}
            <div className="sticky top-0 bg-white z-50">
              <div className="pt-8 px-4 md:px-12 lg:px-24 xl:px-36">
                {/* Query title */}
                <h2
                  className="text-2xl font-medium text-gray-800 text-left font-noto-kufi transition-all duration-300"
                  style={{
                    marginBottom: "16px",
                    paddingLeft: "4px",
                  }}
                >
                  {userMessage.content}
                </h2>

                {/* Tab navigation */}
                <div
                  className="flex border-b border-gray-200 transition-all duration-300"
                  style={{
                    transform: tabsTransform,
                    position: "relative",
                    zIndex: 1,
                  }}
                >
                  <button
                    className={`px-4 py-2 font-medium text-sm ${
                      activeTab === "Chat" ? "border-b-2" : ""
                    }`}
                    onClick={() => handleTabClick("Chat")}
                    style={{
                      color: activeTab === "Chat" ? "#e84990" : "rgb(75 85 99)",
                      borderBottomColor: activeTab === "Chat" ? "#e84990" : "transparent",
                    }}
                  >
                    Chat
                  </button>
                  <button
                    className={`px-4 py-2 font-medium text-sm ${
                      activeTab === "DAG" ? "border-b-2" : ""
                    }`}
                    onClick={() => handleTabClick("DAG")}
                    style={{
                      color: activeTab === "DAG" ? "#e84990" : "rgb(75 85 99)",
                      borderBottomColor: activeTab === "DAG" ? "#e84990" : "transparent",
                    }}
                  >
                    DAG
                  </button>
                  <div className="flex-grow"></div>
                  <button
                    className={`px-4 py-2 font-medium text-sm ${
                      activeTab === "Tasks" ? "border-b-2" : ""
                    }`}
                    onClick={() => handleTabClick("Tasks")}
                    style={{
                      color: activeTab === "Tasks" ? "#e84990" : "rgb(75 85 99)",
                      borderBottomColor: activeTab === "Tasks" ? "#e84990" : "transparent",
                    }}
                  >
                    Tasks
                  </button>
                </div>
              </div>
            </div>

            {/* Response content with padding matching header */}
            <div className="pt-6 pb-10 px-4 md:px-12 lg:px-24 xl:px-36">
              {activeTab === "Chat" ? (
                assistantMessage ? (
                  assistantMessage.isStreaming ? (
                    <div className="flex items-center space-x-2 mb-3">
                      <div
                        className="inline-block h-4 w-4 animate-pulse rounded-full"
                        style={{ backgroundColor: "#775A0B" }}
                      ></div>
                      <span className="text-sm" style={{ color: "#775A0B" }}>
                        Omnis is thinking...
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="whitespace-pre-wrap text-gray-800">
                        <style jsx global>{`
                          .markdown-content h1,
                          .markdown-content h2,
                          .markdown-content h3,
                          .markdown-content h4,
                          .markdown-content h5,
                          .markdown-content h6 {
                            font-weight: 600;
                            margin-top: 6px;
                            margin-bottom: 4px;
                          }
                          .markdown-content h1 {
                            font-size: 1.5rem;
                          }
                          .markdown-content h2 {
                            font-size: 1.25rem;
                          }
                          .markdown-content h3 {
                            font-size: 1.125rem;
                          }

                          .markdown-content p {
                            margin-top: 2px;
                            margin-bottom: 2px;
                            line-height: 1.3;
                          }

                          .markdown-content ul,
                          .markdown-content ol {
                            margin-top: 2px;
                            margin-bottom: 2px;
                            padding-left: 1.5rem;
                          }

                          .markdown-content li {
                            margin-top: 0px;
                            margin-bottom: 0px;
                            padding-left: 0.25rem;
                          }

                          .markdown-content strong {
                            font-weight: 600;
                          }

                          .markdown-content a {
                            color: #775a0b;
                            text-decoration: underline;
                          }

                          .markdown-content code {
                            background-color: rgba(0, 0, 0, 0.05);
                            padding: 0.1rem 0.2rem;
                            border-radius: 0.2rem;
                            font-size: 0.9em;
                          }

                          .markdown-content pre {
                            background-color: rgba(0, 0, 0, 0.05);
                            padding: 0.5rem;
                            border-radius: 0.2rem;
                            overflow-x: auto;
                            margin: 4px 0;
                          }

                          .markdown-content pre code {
                            background-color: transparent;
                            padding: 0;
                          }

                          .markdown-content blockquote {
                            border-left: 3px solid #775a0b;
                            padding-left: 0.5rem;
                            margin-left: 0;
                            margin-right: 0;
                            font-style: italic;
                          }

                          .markdown-content hr {
                            border: 0;
                            border-top: 1px solid #e0e0e0;
                            margin: 4px 0;
                          }

                          .markdown-content table {
                            border-collapse: collapse;
                            width: 100%;
                            margin-top: 4px;
                            margin-bottom: 4px;
                          }

                          .markdown-content th,
                          .markdown-content td {
                            border: 1px solid #e0e0e0;
                            padding: 0.25rem 0.5rem;
                            text-align: left;
                          }

                          .markdown-content th {
                            background-color: rgba(0, 0, 0, 0.05);
                          }
                        `}</style>
                        <div className="markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {assistantMessage.content || defaultResponse}
                          </ReactMarkdown>
                        </div>
                      </div>

                      {/* Update the dashboard rendering with preserved state */}
                      {(() => {
                        // Check if the user message is a health prompt, Isuzu prompt, Back-to-School prompt, or ESG prompt
                        const isHealthPromptCheck = isHealthPrompt(userMessage.content);
                        const isIzuzuPromptCheck = isIzuzuPrompt(userMessage.content);
                        const isBackToSchoolPromptCheck = isBackToSchoolPrompt(userMessage.content);
                        const isESGPromptCheck = isESGPrompt(userMessage.content);
                        const shouldShowDashboard = isHealthPromptCheck || isIzuzuPromptCheck || isBackToSchoolPromptCheck || isESGPromptCheck;
                        
                        console.log(`Dashboard routing check for: "${userMessage.content.substring(0, 50)}..."`);
                        console.log(`- Health: ${isHealthPromptCheck}, Isuzu: ${isIzuzuPromptCheck}, BackToSchool: ${isBackToSchoolPromptCheck}, ESG: ${isESGPromptCheck}`);
                        console.log(`- Should show dashboard: ${shouldShowDashboard}`);
                        console.log(`- DAG Completed: ${dagCompleted}, Message ID: ${messageId}`);

                        if (shouldShowDashboard) {
                          // Determine which dashboard to show based on prompt type
                          const DashboardComponent = isBackToSchoolPromptCheck 
                            ? TVGChatDashboard  // Use TVG retail analytics for back-to-school
                            : isESGPromptCheck
                            ? ESGChatDashboard  // Use ESG analytics for ESG prompts
                            : ChatDashboard;    // Use autonomous vehicle dashboard for health/Isuzu
                          
                          console.log(`Selected dashboard: ${
                            isBackToSchoolPromptCheck ? 'TVGChatDashboard (Retail)' : 
                            isESGPromptCheck ? 'ESGChatDashboard (ESG Portfolio)' :
                            'ChatDashboard (Vehicle)'
                          }`);

                          // UNIVERSAL RULE: All dashboard types only show AFTER DAG completion
                          // Check BOTH global completion AND per-message persistent completion
                          const isDagCompletedForThisMessage = 
                            (dagCompleted && lastCompletedMessageId === userMessageId) ||
                            completedDAGsByMessage[userMessageId] === true;
                          
                          console.log(`Dashboard completion check for ${userMessageId}: global=${dagCompleted && lastCompletedMessageId === userMessageId}, persistent=${completedDAGsByMessage[userMessageId]}, final=${isDagCompletedForThisMessage}`);
                          
                          if (!isDagCompletedForThisMessage) {
                            return (
                              <div className="mt-4 flex items-center space-x-2">
                                <div className="inline-block h-4 w-4 animate-pulse rounded-full bg-amber-600"></div>
                                <span className="text-sm text-amber-700">
                                  Omnis is thinking...
                                </span>
                              </div>
                            );
                          }

                          // For previously loaded dashboards AND not a new message
                          // OR if we're just switching tabs, show the dashboard directly
                          if (
                            (dashboardLoaded[messageId] && !isNewMessage) ||
                            tabSwitched
                          ) {
                            return (
                              <div className="mt-4">
                                <div
                                  className="z-10"
                                  style={{ isolation: "isolate" }}
                                  id={`chat-dashboard-container-${messageId}`}
                                >
                                  <DashboardComponent key={messageId} />
                                </div>
                              </div>
                            );
                          }

                          // Show dashboard loading only AFTER DAG completion
                          return (
                            <div className="mt-4">
                              <DashboardWithLoading
                                messageId={messageId}
                                dashboardComponent={DashboardComponent}
                                onLoad={() => {
                                  setDashboardLoaded((prev) => ({
                                    ...prev,
                                    [messageId]: true,
                                  }));
                                }}
                              />
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </>
                  )
                ) : (
                  <div className="flex items-center space-x-2">
                    <div className="inline-block h-4 w-4 animate-pulse rounded-full bg-amber-500"></div>
                    <span className="text-sm text-amber-700">
                      Waiting for response...
                    </span>
                  </div>
                )
              ) : activeTab === "DAG" ? (
                (() => {
                  const shouldShowDAG = isHealthPrompt(userMessage.content) || isIzuzuPrompt(userMessage.content) || isBackToSchoolPrompt(userMessage.content) || isESGPrompt(userMessage.content);

                  if (shouldShowDAG) {
                    // For ESG prompts, use the dedicated ESG DAG visualization
                    if (isESGPrompt(userMessage.content)) {
                      return (
                        <Suspense
                          fallback={
                            <div className="min-h-[450px] flex items-center justify-center">
                              <div className="text-center">
                                <div
                                  className="w-12 h-12 border-4 border-t-2 rounded-full animate-spin mx-auto mb-4"
                                  style={{
                                    borderColor: "#059669",
                                    borderTopColor: "#16a34a",
                                  }}
                                ></div>
                                <p className="text-gray-600">
                                  Loading ESG portfolio analysis workflow...
                                </p>
                              </div>
                            </div>
                          }
                        >
                          <ESGDAGVisualization 
                            messageId={userMessage.id}
                            onDAGComplete={() => handleDAGCompletion(sectionIndex, userMessageId)}
                          />
                        </Suspense>
                      );
                    }

                    // For other prompts, use the standard DAG visualization
                    return (
                      <Suspense
                        fallback={
                          <div className="min-h-[450px] flex items-center justify-center">
                            <div className="text-center">
                              <div
                                className="w-12 h-12 border-4 border-t-2 rounded-full animate-spin mx-auto mb-4"
                                style={{
                                  borderColor: "#a18b5c44",
                                  borderTopColor: "#a18b5c",
                                }}
                              ></div>
                              <p className="text-gray-600">
                                Loading visualization...
                              </p>
                            </div>
                          </div>
                        }
                      >
                        <DAGVisualization
                          onDAGComplete={() =>
                            handleDAGCompletion(sectionIndex, userMessageId)
                          }
                          messageId={userMessage.id}
                          isMeaslesUseCase={false}
                          isIzuzuUseCase={isIzuzuPrompt(userMessage.content)}
                          isBackToSchoolUseCase={isBackToSchoolPrompt(userMessage.content)}
                        />
                      </Suspense>
                    );
                  }

                  return (
                    <div className="min-h-[450px] flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-gray-600 mb-2">
                          No DAG visualization available for this query.
                        </p>
                        <p className="text-gray-500 text-sm">
                          Try the healthcare use case for a demonstration.
                        </p>
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>
          </div>
        );
      }
    }

    // Return sections in chronological order (oldest first, newest last)
    return sections;
  };

  // Create an effect specifically to handle scrolling when messages change
  useEffect(() => {
    if (deduplicatedMessages.length <= 1) return; // Need at least a message pair

    const scrollToLatestSection = () => {
      if (!contentRef.current) {
        console.log("Content ref not available");
        return;
      }

      // Find the latest section with data attribute
      const latestSection = document.querySelector(
        '[data-is-latest="true"]'
      ) as HTMLElement;

      if (!latestSection) {
        console.log("Latest section not found");
        return;
      }

      // Use scrollIntoView directly - simplest approach with built-in browser support
      latestSection.scrollIntoView({ block: "start", behavior: "auto" });

      // Show animation
      setShowNewMessageAnimation(true);
      setTimeout(() => setShowNewMessageAnimation(false), 1000);
    };

    // Use a single timeout with enough delay for DOM to be ready
    const timeout = setTimeout(scrollToLatestSection, 100);

    return () => {
      clearTimeout(timeout);
    };
  }, [deduplicatedMessages.length]);

  // Handle send message with a simplified approach
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const query = inputValue.trim();
    setInputValue("");

    // Reset tab switching flag when sending a new message
    setTabSwitched(false);

    // Reset DAG and video completion tracking
    setDagCompleted(false);
    setVideoWatched(false);

    // Check if it's a health-related, Isuzu-related, ESG-related, or Back-to-School-related message
    const isHealth = isHealthPrompt(query);
    const isIsuzu = isIzuzuPrompt(query);
    const isBackToSchool = isBackToSchoolPrompt(query);
    const isESG = isESGPrompt(query);

    // Clear any cached DAG state for fresh execution when sending new DAG-related messages
    if (isHealth || isIsuzu || isBackToSchool || isESG) {
      console.log(`New ${isESG ? 'ESG' : isHealth ? 'Health' : isIsuzu ? 'Isuzu' : 'BackToSchool'} message detected - clearing DAG cache for fresh execution`);
      
      // Clear localStorage DAG cache to ensure fresh execution
      try {
        const completedDAGs = localStorage.getItem("omnis_completed_dags");
        if (completedDAGs) {
          console.log("Clearing previous DAG cache for fresh execution");
          localStorage.removeItem("omnis_completed_dags");
        }
      } catch (error) {
        console.log("Could not clear DAG cache:", error);
      }
    }

    // Send the message - ensure it's shown as a user message, not a system prompt
    await sendMessage(query);

    // If it's a health, Isuzu, ESG, or Back-to-School prompt, switch to DAG tab after a brief delay
    if (isHealth || isIsuzu || isBackToSchool || isESG) {
      console.log(
        "Health/Isuzu/ESG/Back-to-School-related message detected, switching to DAG tab shortly"
      );
      setTimeout(() => {
        setActiveTab("DAG");
      }, 500);
    }

    // Use a single attempt with enough delay
    setTimeout(() => {
      // Find the latest section
      const latestSection = document.querySelector(
        '[data-is-latest="true"]'
      ) as HTMLElement;

      if (latestSection) {
        // Direct browser scrolling - most reliable
        latestSection.scrollIntoView({ block: "start", behavior: "auto" });
      }
    }, 500);
  };

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Create a wrapper component for the main DAG page (not within message sections)
  function MainDAGContent() {
    // Use states from the parent component via context if needed
    const { messages } = useLettaChat();
    const [isLoading, setIsLoading] = useState(true);
    const [isVisible, setIsVisible] = useState(false);
    const mainDagMountedRef = useRef(false);

    // Check if there are any health, Isuzu, or Back-to-School prompt messages
    const hasDAGPrompt = useMemo(() => {
      return messages.some(
        (msg) => msg.role === "user" && (isHealthPrompt(msg.content) || isIzuzuPrompt(msg.content) || isBackToSchoolPrompt(msg.content))
      );
    }, [messages]);

    // Get the most recent health, Isuzu, or Back-to-School prompt message ID for the DAG
    const latestDAGPromptId = useMemo(() => {
      // Find the latest health, Isuzu, or Back-to-School prompt message
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "user" && (isHealthPrompt(msg.content) || isIzuzuPrompt(msg.content) || isBackToSchoolPrompt(msg.content))) {
          return msg.id;
        }
      }
      // Fallback
      return "main-content";
    }, [messages]);

    // Loading animation effect
    useEffect(() => {
      if (hasDAGPrompt && !mainDagMountedRef.current) {
        setIsVisible(true);
        const timer = setTimeout(() => {
          setIsLoading(false);
          mainDagMountedRef.current = true;
        }, 3000);

        return () => clearTimeout(timer);
      } else if (hasDAGPrompt) {
        setIsVisible(true);
        setIsLoading(false);
      } else {
        setIsVisible(false);
        setIsLoading(true);
        mainDagMountedRef.current = false;
      }
    }, [hasDAGPrompt]);

    // Handle DAG completion for main content
    const handleMainDAGCompletion = () => {
      console.log("Main DAG workflow completed - waiting for video");

      // Get the ID of the latest health/Isuzu prompt for tracking
      const latestHealthId = latestDAGPromptId || "main-content";

      // Store this health messageId to prevent re-processing
      seenHealthPromptsRef.current.add(latestHealthId);

      // Mark DAG as completed
      setDagCompleted(true);
      // Store the message ID
      setLastCompletedMessageId(latestHealthId);

      // Only switch to Chat tab if measles video is not showing or has been watched
      if (!showMeaslesVideoPopup || videoWatched) {
        console.log("Video already completed, switching to Chat tab");

        // Show chat output video when switching to chat tab (if enabled)
        // if (isVideoEnabled("chatOutput")) {
        //   setShowChatOutputVideoPopup(true);
        // } // DISABLED: Video popup deactivated

        setActiveTab("Chat");
      } else {
        console.log(
          "Waiting for video to complete before switching to Chat tab"
        );
      }
    };

    if (!isVisible) {
      return (
        <div className="min-h-[450px] flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-600 mb-2">
              No DAG visualization available.
            </p>
            <p className="text-gray-500 text-sm">
              Try the healthcare use case for a demonstration.
            </p>
          </div>
        </div>
      );
    }

    if (isLoading) {
      return (
        <div className="min-h-[450px] flex items-center justify-center">
          <div className="text-center">
            <div
              className="w-12 h-12 border-4 border-t-2 rounded-full animate-spin mx-auto mb-4"
              style={{ borderColor: "#a18b5c44", borderTopColor: "#a18b5c" }}
            ></div>
            <p className="text-gray-600">Generating DAG visualization...</p>
          </div>
        </div>
      );
    }

    return (
      <div>
        <Suspense fallback={<DAGLoadingFallback />}>
          <DAGVisualization
            onDAGComplete={handleMainDAGCompletion}
            messageId={latestDAGPromptId}
            isMeaslesUseCase={false}
            isIzuzuUseCase={(() => {
              // Find the latest health/isuzu/back-to-school prompt message
              for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.role === "user" && (isHealthPrompt(msg.content) || isIzuzuPrompt(msg.content) || isBackToSchoolPrompt(msg.content))) {
                  return isIzuzuPrompt(msg.content);
                }
              }
              return false;
            })()}
            isBackToSchoolUseCase={(() => {
              // Find the latest health/isuzu/back-to-school prompt message
              for (let i = messages.length - 1; i >= 0; i--) {
                const msg = messages[i];
                if (msg.role === "user" && (isHealthPrompt(msg.content) || isIzuzuPrompt(msg.content) || isBackToSchoolPrompt(msg.content))) {
                  return isBackToSchoolPrompt(msg.content);
                }
              }
              return false;
            })()}
          />
        </Suspense>
      </div>
    );
  }

  // Add a watch for new health-related messages to ensure DAG tab is activated
  useEffect(() => {
    // Only proceed if there are messages to process
    if (deduplicatedMessages.length === 0) return;

    // Get the most recent user message
    let lastUserMessageIndex = -1;
    for (let i = deduplicatedMessages.length - 1; i >= 0; i--) {
      if (deduplicatedMessages[i].role === "user") {
        lastUserMessageIndex = i;
        break;
      }
    }

    if (lastUserMessageIndex === -1) return; // No user messages found

    const lastUserMessage = deduplicatedMessages[lastUserMessageIndex];

    // Skip if we've already seen this health prompt message (prevents duplicate processing)
    if (seenHealthPromptsRef.current.has(lastUserMessage.id)) return;

    // Skip if this isn't a health prompt, Isuzu prompt, or Back-to-School prompt
    if (!isHealthPrompt(lastUserMessage.content) && !isIzuzuPrompt(lastUserMessage.content) && !isBackToSchoolPrompt(lastUserMessage.content)) return;

    // Skip if we're already on the DAG tab
    if (activeTab === "DAG") return;

    // Check if this message has a response yet
    const hasResponse =
      lastUserMessageIndex < deduplicatedMessages.length - 1 &&
      deduplicatedMessages[lastUserMessageIndex + 1].role === "assistant";

    // For any health, Isuzu, or Back-to-School prompt message (with or without response), switch to DAG tab
    console.log(
      `Health/Isuzu/Back-to-School prompt detected (messageId: ${lastUserMessage.id}), switching to DAG tab automatically`
    );
    setActiveTab("DAG");

    // If it's a new message without response, it will be processed when the response arrives
    if (!hasResponse) {
      console.log(
        `New health prompt ${lastUserMessage.id} without response yet`
      );
    }
  }, [deduplicatedMessages, activeTab, isHealthPrompt, isIzuzuPrompt, isBackToSchoolPrompt]);



  return (
    <div className="h-screen bg-gray-50 font-noto-kufi">
      {/* Collapsible sidebar with main content */}
      <ChatSidebar>
        <div className="flex flex-col h-full max-h-screen overflow-hidden">
          {/* Main content area with scrollable sections */}
          <div
            ref={contentRef}
            className="flex-1 overflow-y-auto pb-4 relative z-0"
          >
            {/* Always render the message sections with headers */}
            <div className="text-gray-700">
              {deduplicatedMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full min-h-[50vh] px-4 md:px-20 lg:px-40 xl:px-60">
                  <div className="text-center">
                    {agentId === null ? (
                      // Check if a server error flag exists from failed creation attempts
                      typeof window !== "undefined" &&
                      localStorage.getItem("letta_server_error") === "true" ? (
                        <div>
                          <p className="text-red-500 mb-2">
                            Failed to create or connect to Letta agent.
                          </p>
                          <p className="text-gray-500 mb-4">
                            Please check the server configuration and ensure it's
                            running correctly.
                          </p>
                          <p className="text-gray-500 mb-4">
                            If the problem persists, try clearing the stored
                            connection state:
                          </p>
                          <ul className="text-left text-gray-600 mb-4 mx-auto max-w-md">
                            <li className="mb-2">
                              • Verify server address:{" "}
                              <code className="bg-gray-100 px-1 rounded">
                                {process.env.NEXT_PUBLIC_LETTA_URL ||
                                  "http://localhost:8283"}
                              </code>
                            </li>
                            <li className="mb-2">
                              • Confirm required API keys (e.g., OpenAI) are set
                              on the server.
                            </li>
                            <li className="mb-2">
                              • Ensure the model and embedding provider/names are
                              correct.
                            </li>
                            <li className="mb-2">
                              • Check server logs for detailed errors.
                            </li>
                          </ul>
                          <button
                            onClick={async () => {
                              if (typeof window !== "undefined") {
                                console.log(
                                  "Clearing letta_server_error and letta_agent_id from localStorage."
                                );
                                localStorage.removeItem("letta_server_error");
                                localStorage.removeItem("letta_agent_id");
                                alert(
                                  "Local cache cleared. Reloading page to retry connection."
                                );
                                window.location.reload();
                              }
                            }}
                            className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
                          >
                            Clear Local Cache & Retry Connection
                          </button>
                        </div>
                      ) : (
                        // Case where agentId is null but no server error flag (e.g., initial load before agent is ready)
                        <p className="text-gray-500">
                          Initializing agent connection...
                        </p>
                      )
                    ) : // Agent ID exists, proceed normally
                    messages.length === 0 ? (
                      <p className="text-gray-500">
                        No results yet. Start a conversation from the prompt page.
                      </p>
                    ) : (
                      // Render messages
                      <div className="space-y-0">
                        {renderChatSections()}
                        <div ref={messagesEndRef} className="h-20" />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-0">
                  {renderChatSections()}
                  <div ref={messagesEndRef} className="h-20" />
                </div>
              )}
            </div>
          </div>

          {/* Input area always shown at the bottom */}
          <div className="sticky bottom-0 left-0 right-0 z-10 bg-white border-t border-gray-200 p-4 shadow-lg">
            <div className="w-full max-w-screen-2xl mx-auto px-4 md:px-12 lg:px-24 xl:px-36 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <div></div>
              </div>
              <div className="flex items-center space-x-2">
                <div className="relative flex-grow">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your message here..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-800 focus:border-transparent"
                    disabled={streaming}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!inputValue.trim() || streaming}
                    className={`absolute right-2 top-1/2 transform -translate-y-1/2 p-1 rounded-full ${
                      !inputValue.trim() || streaming
                        ? "text-gray-400"
                        : "text-amber-800 hover:bg-amber-100"
                    }`}
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
                <button
                  className="p-2 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300"
                  onClick={() => {} /* Add voice input handler */}
                  disabled={streaming}
                >
                  <Mic className="h-5 w-5" />
                </button>
                <Link
                  href="/prompt"
                  className="p-2 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300"
                >
                  <Plus className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </ChatSidebar>
    </div>
  );
}

// Add loading spinner component (if it doesn't exist)
// This will be used after current `SendWithFallbackEndpoint` function at the bottom
export function DashboardLoader() {
  return (
    <div className="mt-4 bg-gray-200 border border-gold/30 rounded-lg overflow-hidden">
      <div className="bg-gray-100 p-2 flex justify-between items-center border-b border-gold/30">
        <h3 className="text-sm font-medium text-gray-700">
          Omnis is building your dashboard
        </h3>
      </div>
      <div className="h-[450px] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gold/30 border-t-gold rounded-full animate-spin"></div>
        <div className="ml-3 text-sm text-gray-600">
          Processing data for visualization...
        </div>
      </div>
    </div>
  );
}

// Create a dashboard wrapper component with guaranteed loading state
function DashboardWithLoading({
  messageId,
  onLoad,
  dashboardComponent: DashboardComponent = ChatDashboard,
}: {
  messageId?: string;
  onLoad?: () => void;
  dashboardComponent?: React.ComponentType;
}) {
  // Local state for this component
  const [isLoading, setIsLoading] = useState(true);
  const dashboardMountedRef = useRef(false);

  // Force loading state on mount, then switch to dashboard
  useEffect(() => {
    console.log("DASHBOARD: Mounting with forced loading state");

    // Only perform this once
    if (!dashboardMountedRef.current) {
      // Set a timeout to switch to the dashboard
      const timer = setTimeout(() => {
        console.log("DASHBOARD: Loading complete, showing dashboard");
        setIsLoading(false);
        dashboardMountedRef.current = true;
        if (onLoad) onLoad();
      }, 3000); // Reduced from 5000ms to 3000ms for better UX

      return () => clearTimeout(timer);
    }
  }, [onLoad]);

  // Generate a stable key based on messageId or random if not provided
  const stableDashboardKey = useMemo(
    () =>
      messageId || `dashboard-${Math.random().toString(36).substring(2, 9)}`,
    [messageId]
  );

  // Always show loading first, then dashboard
  return isLoading ? (
    // Loading state - show spinner and message
    <div className="bg-gray-200 border border-gold/30 rounded-lg overflow-hidden z-10">
      <div className="bg-gray-100 p-2 flex justify-between items-center border-b border-gold/30">
        <h3 className="text-sm font-medium text-gray-700">
          Omnis is building your dashboard
        </h3>
      </div>
      <div className="h-[450px] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gold/30 border-t-gold rounded-full animate-spin"></div>
        <div className="ml-3 text-sm text-gray-600">
          Processing data for visualization...
        </div>
      </div>
    </div>
  ) : (
    // Directly render the chosen Dashboard component with z-index to stay below header
    <div
      className="z-10"
      style={{ isolation: "isolate" }}
      id={`chat-dashboard-container-${stableDashboardKey}`}
    >
      <DashboardComponent key={stableDashboardKey} />
    </div>
  );
}

// Add the DAG loading and wrapper components at the end of the file
function DAGLoadingFallback() {
  return (
    <div className="min-h-[450px] flex items-center justify-center">
      <div className="text-center">
        <div
          className="w-12 h-12 border-4 border-t-2 rounded-full animate-spin mx-auto mb-4"
          style={{ borderColor: "#a18b5c44", borderTopColor: "#a18b5c" }}
        ></div>
        <p className="text-gray-600">Loading DAG visualization...</p>
      </div>
    </div>
  );
}
