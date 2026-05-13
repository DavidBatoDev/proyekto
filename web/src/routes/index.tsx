import { createFileRoute } from "@tanstack/react-router";
import { PresentationContainer } from "@/components/root/PresentationContainer";
import { SectionWrapper } from "@/components/root/SectionWrapper";
import { HeroSection } from "@/components/root/HeroSection";
import { UseItYourWaySection } from "@/components/root/UseItYourWaySection";
import { HowItWorks } from "@/components/root/HowItWorks";
import { AIDemoSection } from "@/components/root/AIDemoSection";
import { WhyProyektoSection } from "@/components/root/WhyProyektoSection";
import { TemplatesSection } from "@/components/root/TemplatesSection";
import { ProductExperienceSection } from "@/components/root/ProductExperienceSection";
import { CTAFooterSection } from "@/components/root/CTAFooterSection";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <PresentationContainer>
      <SectionWrapper animationKey="hero" id="hero">
        <HeroSection />
      </SectionWrapper>
      <SectionWrapper animationKey="use-it-your-way" id="use-it-your-way">
        <UseItYourWaySection />
      </SectionWrapper>
      <SectionWrapper animationKey="how-it-works" id="how-it-works">
        <HowItWorks />
      </SectionWrapper>
      <SectionWrapper animationKey="ai-demo" id="ai-demo">
        <AIDemoSection />
      </SectionWrapper>
      <SectionWrapper animationKey="why-proyekto" id="why-proyekto">
        <WhyProyektoSection />
      </SectionWrapper>
      <SectionWrapper animationKey="templates" id="templates">
        <TemplatesSection />
      </SectionWrapper>
      <SectionWrapper animationKey="features" id="features">
        <ProductExperienceSection />
      </SectionWrapper>
      <SectionWrapper animationKey="cta-footer" id="cta-footer">
        <CTAFooterSection />
      </SectionWrapper>
    </PresentationContainer>
  );
}
