import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/root/Header";
import { HeroSection } from "@/components/root/HeroSection";
import { TrustSection } from "@/components/root/TrustSection";
import { HowItWorks } from "@/components/root/HowItWorks";
import { ProductExperienceSection } from "@/components/root/ProductExperienceSection";
import { TemplatesSection } from "@/components/root/TemplatesSection";
import { YourRoadmapSection } from "@/components/root/YourRoadmapSection";
import { CTASection } from "@/components/root/CTASection";
import { RootFooter } from "@/components/root/RootFooter";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <Header />

      <main className="pb-20 pt-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <HeroSection />
          <TrustSection />
          <HowItWorks />
          <ProductExperienceSection />
          <TemplatesSection />
          <YourRoadmapSection />
          <CTASection />
        </div>
      </main>

      <RootFooter />
    </div>
  );
}
