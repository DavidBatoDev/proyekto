import { useState, useRef, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, RotateCcw, Sparkles, ListTodo, GitBranch } from "lucide-react";

type DemoState = "idle" | "thinking" | "done";

type MockFeature = {
  title: string;
  description: string;
  taskCount: number;
  tasks: string[];
};

type MockEpic = {
  title: string;
  description: string;
  features: MockFeature[];
};

type MockRoadmap = {
  name: string;
  epics: MockEpic[];
};

// Fixed heights to allow precise connecting line calculations
const FEATURE_H = 108; // px — fixed feature card height
const FEATURE_GAP = 12; // px — gap-3

const ROADMAPS: Record<string, MockRoadmap> = {
  saas: {
    name: "SaaS MVP Launch",
    epics: [
      {
        title: "Core API & Integration",
        description: "Core API and SDKs that expose the product's core functionality to developers.",
        features: [
          { title: "Public REST API", description: "Design and implement REST endpoints with versioning.", taskCount: 4, tasks: ["Define API surface", "Implement endpoints", "Add rate limiting"] },
          { title: "API Key Management", description: "User registration, API key issuance, and rotation.", taskCount: 3, tasks: ["Build signup flow", "Key generation", "Auth middleware"] },
        ],
      },
      {
        title: "Launch & Business Ops",
        description: "Billing, launch readiness, and go-to-market preparation for paying customers.",
        features: [
          { title: "Billing & Plans", description: "Integrate Stripe and define pricing tiers.", taskCount: 3, tasks: ["Stripe integration", "Pricing tiers", "Invoice automation"] },
          { title: "Marketing Launch", description: "Blog, social channels, and launch campaign.", taskCount: 4, tasks: ["Landing page", "Blog post", "Social setup"] },
        ],
      },
    ],
  },
  mobile: {
    name: "Mobile App Build",
    epics: [
      {
        title: "Design & Prototyping",
        description: "UX wireframes, visual design system, and an interactive prototype for sign-off.",
        features: [
          { title: "UX Wireframes & Flow", description: "Map key user journeys and produce low-fi wireframes.", taskCount: 4, tasks: ["User journeys", "Wireframes", "Flow review"] },
          { title: "UI Design System", description: "Tokens, components, and screens ready for dev handoff.", taskCount: 5, tasks: ["Design tokens", "Component kit", "Screen designs"] },
        ],
      },
      {
        title: "Build & App Store Launch",
        description: "Core screen development, API integration, and App Store submission.",
        features: [
          { title: "Core Screens & Auth", description: "Build primary screens and implement the auth flow.", taskCount: 7, tasks: ["Onboarding screens", "Auth integration", "Core screens"] },
          { title: "App Store Submission", description: "Prepare assets, pass review, and publish.", taskCount: 4, tasks: ["App icons", "Store listing", "Review submission"] },
        ],
      },
    ],
  },
  ecommerce: {
    name: "E-commerce Launch",
    epics: [
      {
        title: "Store & Catalog",
        description: "Platform setup, product catalog, and fully functional checkout.",
        features: [
          { title: "Platform Setup", description: "Configure domain, branding, and payment gateway.", taskCount: 4, tasks: ["Domain setup", "Branding", "Payment gateway"] },
          { title: "Product Pages & Checkout", description: "Build product listings, categories, and checkout flow.", taskCount: 6, tasks: ["Product pages", "Categories", "Checkout flow"] },
        ],
      },
      {
        title: "Marketing & Growth",
        description: "SEO foundations, social presence, and paid acquisition campaigns.",
        features: [
          { title: "SEO & Content", description: "On-page SEO, blog posts, and meta setup.", taskCount: 3, tasks: ["On-page SEO", "Blog setup", "Meta tags"] },
          { title: "Paid Campaigns", description: "Google and Meta ad campaigns targeting ideal customers.", taskCount: 4, tasks: ["Ad creative", "Google Ads", "Meta Ads"] },
        ],
      },
    ],
  },
  website: {
    name: "Website Build",
    epics: [
      {
        title: "Strategy & Design",
        description: "Site goals, wireframes, and a polished visual design ready for development.",
        features: [
          { title: "Discovery & Wireframes", description: "Define goals, sitemap, and low-fi wireframes.", taskCount: 3, tasks: ["Goals & sitemap", "Content plan", "Wireframes"] },
          { title: "Visual Design", description: "Final designs for all pages with brand system.", taskCount: 5, tasks: ["Design system", "Page designs", "Prototype review"] },
        ],
      },
      {
        title: "Development & Launch",
        description: "Frontend build, CMS integration, and production deployment.",
        features: [
          { title: "Frontend Development", description: "Build all pages, responsive at every breakpoint.", taskCount: 7, tasks: ["Page builds", "Responsive QA", "CMS setup"] },
          { title: "Deploy & Analytics", description: "Production deploy, SEO, and analytics wired up.", taskCount: 3, tasks: ["Deploy", "Analytics", "Performance"] },
        ],
      },
    ],
  },
  default: {
    name: "Project Roadmap",
    epics: [
      {
        title: "Planning & Execution",
        description: "Scope definition, team alignment, and delivery of core project work.",
        features: [
          { title: "Scope & Team Setup", description: "Agree on scope, assemble the team, lock the timeline.", taskCount: 4, tasks: ["Scope doc", "Team assembly", "Timeline"] },
          { title: "Core Deliverables", description: "Execute the main body of work with regular reviews.", taskCount: 8, tasks: ["Sprint planning", "Core work", "Reviews"] },
        ],
      },
      {
        title: "Quality & Delivery",
        description: "QA, stakeholder feedback, and final handoff with documentation.",
        features: [
          { title: "QA & Testing", description: "Run QA, gather stakeholder feedback, and polish.", taskCount: 5, tasks: ["QA process", "Feedback", "Refinements"] },
          { title: "Final Handoff", description: "Deliver with documentation and a retrospective.", taskCount: 3, tasks: ["Documentation", "Handoff", "Retrospective"] },
        ],
      },
    ],
  },
};

const SUGGESTIONS = [
  "Build a SaaS MVP",
  "Launch an e-commerce store",
  "Build a mobile app",
  "Create a website",
];

function detectRoadmap(text: string): MockRoadmap {
  const lower = text.toLowerCase();
  if (/saas|startup|product|software/.test(lower)) return ROADMAPS.saas;
  if (/mobile|app\b|ios|android/.test(lower)) return ROADMAPS.mobile;
  if (/ecommerce|e-commerce|store|shop|shopify/.test(lower)) return ROADMAPS.ecommerce;
  if (/website|landing|web\b|blog/.test(lower)) return ROADMAPS.website;
  return ROADMAPS.default;
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-slate-300"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.16 }}
        />
      ))}
    </div>
  );
}

// Draws the ├── connecting lines between the epic and feature cards
function ConnectorLines({ featureCount }: { featureCount: number }) {
  const totalH = featureCount * FEATURE_H + (featureCount - 1) * FEATURE_GAP;
  const epicCenterY = totalH / 2;
  const featureCenters = Array.from({ length: featureCount }, (_, i) =>
    i * (FEATURE_H + FEATURE_GAP) + FEATURE_H / 2
  );

  return (
    <div className="relative w-8 shrink-0" style={{ height: totalH }}>
      {/* Horizontal from epic to trunk */}
      <div
        className="absolute bg-slate-200"
        style={{ top: epicCenterY - 0.5, left: 0, width: 14, height: 1 }}
      />
      {/* Vertical trunk spanning all feature centers */}
      {featureCount > 1 && (
        <div
          className="absolute bg-slate-200"
          style={{
            left: 13.5,
            top: featureCenters[0],
            height: featureCenters[featureCount - 1] - featureCenters[0],
            width: 1,
          }}
        />
      )}
      {/* Horizontal branch to each feature */}
      {featureCenters.map((cy, i) => (
        <div
          key={i}
          className="absolute bg-slate-200"
          style={{ top: cy - 0.5, left: 14, width: 14, height: 1 }}
        />
      ))}
    </div>
  );
}

function EpicCard({
  epic,
  featureCount,
  animated,
  epicIndex,
}: {
  epic: MockEpic | null;
  featureCount: number;
  animated: boolean;
  epicIndex: number;
}) {
  const groupH = featureCount * FEATURE_H + (featureCount - 1) * FEATURE_GAP;

  if (!epic) {
    return (
      <div
        className="w-[38%] shrink-0 rounded-xl border border-dashed border-slate-200 bg-slate-50/60"
        style={{ height: groupH }}
      />
    );
  }

  return (
    <motion.div
      initial={animated ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: epicIndex * 0.18 }}
      className="w-[38%] shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col justify-center"
      style={{ height: groupH }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 leading-snug">{epic.title}</h3>
        <div className="flex gap-1 shrink-0 mt-0.5">
          <div className="h-3.5 w-3.5 rounded bg-slate-100" />
          <div className="h-3.5 w-3.5 rounded bg-slate-100" />
          <div className="h-3.5 w-3.5 rounded bg-slate-100" />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500 line-clamp-3">{epic.description}</p>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">Progress</span>
          <span className="text-[10px] text-slate-400">0%</span>
        </div>
        <div className="h-1 rounded-full bg-slate-100" />
      </div>
      <div className="mt-2.5 flex items-center gap-1">
        <GitBranch className="h-3 w-3 text-slate-400" />
        <span className="text-[10px] text-slate-400">{epic.features.length} features</span>
      </div>
    </motion.div>
  );
}

function FeatureCard({
  feature,
  animated,
  epicIndex,
  featureIndex,
}: {
  feature: MockFeature | null;
  animated: boolean;
  epicIndex: number;
  featureIndex: number;
}) {
  if (!feature) {
    return (
      <div
        className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60"
        style={{ height: FEATURE_H }}
      />
    );
  }

  return (
    <motion.div
      initial={animated ? { opacity: 0, x: 10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: epicIndex * 0.18 + featureIndex * 0.12 + 0.08 }}
      className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
      style={{ height: FEATURE_H }}
    >
      {/* Orange status indicator (matches actual app) */}
      <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-amber-400" />

      <p className="pr-5 text-xs font-semibold text-slate-900 leading-snug">{feature.title}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-slate-500 line-clamp-2">{feature.description}</p>

      <span className="mt-1.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-medium text-slate-500">
        not started
      </span>

      <div className="mt-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[9px] text-slate-400">Progress</span>
          <span className="text-[9px] text-slate-400">0%</span>
        </div>
        <div className="h-0.5 rounded-full bg-slate-100" />
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        <ListTodo className="h-2.5 w-2.5 text-slate-400" />
        <span className="text-[9px] text-slate-400">{feature.taskCount} tasks</span>
        <span className="ml-auto text-[9px] text-slate-400">0/{feature.taskCount} done</span>
      </div>
    </motion.div>
  );
}

function EpicGroup({
  epic,
  epicIndex,
  animated,
}: {
  epic: MockEpic | null;
  epicIndex: number;
  animated: boolean;
}) {
  const featureCount = epic ? epic.features.length : 2;

  return (
    <div className="flex items-center gap-0">
      <EpicCard epic={epic} featureCount={featureCount} animated={animated} epicIndex={epicIndex} />
      <ConnectorLines featureCount={featureCount} />
      <div className="flex flex-1 flex-col" style={{ gap: FEATURE_GAP }}>
        {Array.from({ length: featureCount }).map((_, i) => (
          <FeatureCard
            key={epic ? epic.features[i].title : i}
            feature={epic ? epic.features[i] : null}
            animated={animated}
            epicIndex={epicIndex}
            featureIndex={i}
          />
        ))}
      </div>
    </div>
  );
}

function RoadmapCanvas({
  roadmap,
  state,
}: {
  roadmap: MockRoadmap | null;
  state: DemoState;
}) {
  return (
    <div className="flex flex-col gap-5">
      {[0, 1].map((epicIdx) => {
        if (state === "idle") {
          return <EpicGroup key={epicIdx} epic={null} epicIndex={epicIdx} animated={false} />;
        }
        if (state === "thinking") {
          return (
            <motion.div
              key={epicIdx}
              animate={{ opacity: [0.5, 0.85, 0.5] }}
              transition={{ duration: 1.3, repeat: Infinity, delay: epicIdx * 0.3 }}
            >
              <EpicGroup epic={null} epicIndex={epicIdx} animated={false} />
            </motion.div>
          );
        }
        const epic = roadmap?.epics[epicIdx] ?? null;
        return <EpicGroup key={epicIdx} epic={epic} epicIndex={epicIdx} animated={true} />;
      })}
    </div>
  );
}

export function AIDemoSection({ isActive = false }: { isActive?: boolean }) {
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [input, setInput] = useState("");
  const [submittedInput, setSubmittedInput] = useState("");
  const [activeRoadmap, setActiveRoadmap] = useState<MockRoadmap | null>(null);
  const [aiResponse, setAiResponse] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const autoTriggeredRef = useRef(false);

  // Auto-trigger the demo once when the section becomes active
  useEffect(() => {
    if (!isActive || autoTriggeredRef.current || demoState !== "idle") return;
    autoTriggeredRef.current = true;
    const autoText = "Build a SaaS MVP";
    const timer = setTimeout(() => {
      const roadmap = detectRoadmap(autoText);
      setSubmittedInput(autoText);
      setInput("");
      setDemoState("thinking");
      setTimeout(() => {
        setActiveRoadmap(roadmap);
        setAiResponse(
          `Done! I've mapped out your ${roadmap.name} across 2 epics and ${roadmap.epics.reduce((s, e) => s + e.features.length, 0)} features. Here's your plan:`
        );
        setDemoState("done");
      }, 1800);
    }, 800);
    return () => clearTimeout(timer);
  }, [isActive, demoState]);

  function handleSend() {
    const text = input.trim();
    if (!text || demoState !== "idle") return;
    const roadmap = detectRoadmap(text);
    setSubmittedInput(text);
    setDemoState("thinking");
    setInput("");

    setTimeout(() => {
      setActiveRoadmap(roadmap);
      setAiResponse(
        `Done! I've mapped out your ${roadmap.name} across 2 epics and ${roadmap.epics.reduce((s, e) => s + e.features.length, 0)} features. Here's your plan:`
      );
      setDemoState("done");
    }, 1800);
  }

  function handleReset() {
    autoTriggeredRef.current = false;
    setDemoState("idle");
    setInput("");
    setSubmittedInput("");
    setActiveRoadmap(null);
    setAiResponse("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSend();
  }

  return (
    <section className="flex flex-col h-full py-4 overflow-hidden">
      <div className="mb-4 text-center shrink-0">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
          Use It With AI
        </p>
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Watch Proyekto build your roadmap
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
          Type your project idea and see your plan come to life in seconds.
        </p>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_40px_rgba(16,24,40,0.07)] min-h-0">
        {/* Chrome bar */}
        <div className="shrink-0 flex items-center gap-3 border-b border-slate-200 bg-slate-50/60 px-5 py-3">
          <div className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-red-300" />
            <span className="h-3 w-3 rounded-full bg-amber-300" />
            <span className="h-3 w-3 rounded-full bg-green-300" />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            Roadmap · AI Demo
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] min-h-0 overflow-hidden">
          {/* Left: Roadmap canvas */}
          <div className="overflow-y-auto border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
            {/* Tab bar */}
            <div className="mb-5 flex items-center gap-1 border-b border-slate-100 pb-3">
              <button type="button" className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm border border-slate-200">
                Roadmap
              </button>
              <button type="button" className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700">
                Milestones
              </button>
              {activeRoadmap && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="ml-auto text-[11px] font-semibold text-slate-500"
                >
                  {activeRoadmap.name}
                </motion.span>
              )}
            </div>

            <RoadmapCanvas roadmap={activeRoadmap} state={demoState} />
          </div>

          {/* Right: AI Chat */}
          <div className="flex flex-col bg-slate-50/30">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
                <Sparkles className="h-3.5 w-3.5 text-white" />
              </div>
              <p className="text-sm font-semibold text-slate-900">AI Assistant</p>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Online
              </span>
            </div>

            {/* Messages */}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
                  Hi! Tell me what you're building and I'll create a step-by-step roadmap for you. 👋
                </div>
              </div>

              <AnimatePresence>
                {submittedInput && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-sm text-white shadow-sm">
                      {submittedInput}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence mode="wait">
                {demoState === "thinking" && (
                  <motion.div
                    key="typing"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-start gap-2"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                      <Sparkles className="h-3 w-3 text-white" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white shadow-sm">
                      <TypingIndicator />
                    </div>
                  </motion.div>
                )}
                {demoState === "done" && aiResponse && (
                  <motion.div
                    key="response"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                      <Sparkles className="h-3 w-3 text-white" />
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
                      {aiResponse}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Suggestion chips */}
            <AnimatePresence>
              {demoState === "idle" && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  className="flex flex-wrap gap-1.5 px-4 pb-2"
                >
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm transition-colors hover:border-slate-400 hover:text-slate-900"
                    >
                      {s}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Input */}
            <div className="border-t border-slate-200 bg-white p-3">
              {demoState === "done" ? (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  type="button"
                  onClick={handleReset}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Try another project
                </motion.button>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={demoState === "thinking"}
                    placeholder="Chat or request roadmap edits..."
                    className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || demoState === "thinking"}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-all hover:bg-blue-500 disabled:opacity-35"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
