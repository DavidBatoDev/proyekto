import { ArrowRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuthStore } from "@/stores/authStore";

export function Hero() {
  const { profile } = useAuthStore();
  const persona = profile?.active_persona || "client";
  const isLoading = !profile;

  // Design configuration mapping
  const content = {
    client: {
      title: "Turn your project idea into action — easily",
      description:
        "Start planning your project step-by-step and invite your team. No complex setups, no guesswork — just clarity from the get-go.",
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
      title: "Turn your project idea into action — easily",
      description:
        "Start planning your project step-by-step and invite your team. No complex setups, no guesswork — just clarity from the get-go.",
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
      <div className="relative bg-[#f6f7f8] rounded-xl overflow-hidden animate-pulse h-40">
        <div className="relative z-10 flex items-center h-full px-8 py-4">
          {/* Skeleton Container */}
          <div className="max-w-[540px] w-full">
            {/* Title Skeleton */}
            <div className="bg-gray-200 rounded-md w-3/4 h-6 mb-2" />

            {/* Description Skeleton */}
            <div className="space-y-2 mb-4">
              <div className="h-4 bg-gray-200 rounded-md w-full" />
              <div className="h-4 bg-gray-200 rounded-md w-2/3" />
            </div>

            {/* Button Skeleton */}
            <div className="h-10 bg-gray-200 rounded-md w-48" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden transition-colors duration-500 h-40"
      data-theme={persona}
      style={{ backgroundColor: "var(--primary-light)" }}
    >
      {/* Right SVG Art */}
      <img
        src={currentContent.artSrc}
        alt="decoration"
        className="absolute right-0 top-0 h-full object-cover w-[200px] opacity-55 -scale-x-100"
      />

      <div className="absolute inset-0 opacity-100">
        <div className="absolute top-[-30px] left-[-120px] w-[620px] h-[180px]">
          {/* Decorative circles */}
          <div
            className="absolute w-[174px] h-[145px] rounded-full blur-3xl opacity-90 transition-colors duration-500"
            style={{
              top: "0px",
              left: "101px",
              backgroundColor: "var(--primary)",
            }}
          />
          <div
            className="absolute w-[174px] h-[145px] rounded-full blur-3xl opacity-40 transition-colors duration-500"
            style={{
              top: "207px",
              left: "145px",
              backgroundColor: "var(--secondary-light)",
            }}
          />
          <div
            className="absolute w-[174px] h-[145px] rounded-full blur-3xl opacity-40 transition-colors duration-500"
            style={{
              top: "-31px",
              right: "0px",
              backgroundColor: "var(--primary-dark)",
            }}
          />
        </div>
      </div>

      <div className="relative z-10 h-full px-8 py-4 flex items-center">
        <div className="max-w-[calc(100%-220px)]">
          <h1
            className="text-[#333438] text-[28px] leading-8 font-semibold mb-1 whitespace-nowrap"
          >
          
          </h1>
          <p className="text-[#61636c] text-[14px] leading-5">
            {currentContent.description}
          </p>
          <Link
            to={currentContent.buttonLink}
            data-tutorial={currentContent.dataTutorial}
            className="text-white px-6 py-2 rounded flex items-center gap-2 transition-all w-fit shadow-sm mt-3"
            style={{
              backgroundColor: "var(--secondary)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary-dark)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--secondary)";
            }}
          >
            {currentContent.buttonText}
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
