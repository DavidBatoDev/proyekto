import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";

const personaLabel: Record<string, string> = {
  client: "Client Workspace",
  consultant: "Consultant Workspace",
  freelancer: "Freelancer Workspace",
  admin: "Admin Workspace",
};

export function Hero() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";
  const isLoading = !profile;

  const content = {
    client: {
      title: "Turn your project vision into an execution roadmap.",
      description:
        "Post your vision, get matched with a consultant, and unlock a structured roadmap your team can execute.",
      buttonText: "Post Project Vision",
      buttonLink: "/project-posting",
      dataTutorial: "post-project-btn",
      artSrc: "/svgs/art/client-art.svg",
    },
    freelancer: {
      title: "Get matched to roadmap-driven projects.",
      description:
        "Complete your profile to get matched by consultants and contribute to active milestone delivery.",
      buttonText: "Complete Activation",
      buttonLink: "/freelancer/go-live",
      dataTutorial: "freelancer-go-live-btn",
      artSrc: "/svgs/art/freelancer-art.svg",
    },
    consultant: {
      title: "Share your expertise with the world.",
      description:
        "Help clients shape their vision and build successful products with your guidance.",
      buttonText: "Browse Opportunities",
      buttonLink: "/projects",
      dataTutorial: "browse-opportunities-btn",
      artSrc: "/svgs/art/consultant-art.svg",
    },
    admin: {
      title: "Turn your project vision into an execution roadmap.",
      description:
        "Post your vision, get matched with a consultant, and unlock a structured roadmap your team can execute.",
      buttonText: "Post Project Vision",
      buttonLink: "/project-posting",
      dataTutorial: "post-project-btn",
      artSrc: "/svgs/art/9@2x.svg",
    },
  };

  const currentContent =
    content[persona as keyof typeof content] || content.client;

  if (isLoading) {
    return (
      <div className="app-surface-card relative h-56 overflow-hidden animate-pulse">
        <div className="flex h-full items-center px-8 py-5">
          <div className="w-full max-w-2xl space-y-3">
            <div className="h-4 w-40 rounded-full bg-slate-200" />
            <div className="h-8 w-3/4 rounded-md bg-slate-200" />
            <div className="h-4 w-2/3 rounded-md bg-slate-200" />
            <div className="h-11 w-44 rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="app-surface-card-strong app-slide-up relative overflow-hidden">
      <div className="pointer-events-none absolute -left-14 -top-16 h-64 w-64 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="pointer-events-none absolute right-8 top-0 h-64 w-64 rounded-full bg-amber-200/30 blur-3xl" />
      <img
        src={currentContent.artSrc}
        alt=""
        className="pointer-events-none absolute -right-4 bottom-0 h-[92%] w-52 object-contain opacity-35"
      />

      <div className="relative z-10 flex min-h-56 items-center px-6 py-6 sm:px-8">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            {personaLabel[persona] || "Workspace"}
          </span>

          <h1 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-slate-900 sm:text-3xl">
            {currentContent.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 sm:text-[15px]">
            {currentContent.description}
          </p>

          <Link
            to={currentContent.buttonLink}
            data-tutorial={currentContent.dataTutorial}
            className="app-cta mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
          >
            {currentContent.buttonText}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
