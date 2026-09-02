import { Capacitor } from "@capacitor/core";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AIDemoSection } from "@/components/root/AIDemoSection";
import { CTAFooterSection } from "@/components/root/CTAFooterSection";
import { HeroSection } from "@/components/root/HeroSection";
import { HowItWorks } from "@/components/root/HowItWorks";
import { PresentationContainer } from "@/components/root/PresentationContainer";
import { ProductExperienceSection } from "@/components/root/ProductExperienceSection";
import { SectionWrapper } from "@/components/root/SectionWrapper";
import { TemplatesSection } from "@/components/root/TemplatesSection";
import { UseItYourWaySection } from "@/components/root/UseItYourWaySection";
import { WhyProyektoSection } from "@/components/root/WhyProyektoSection";
import { useAuthStore } from "@/stores/authStore";

/**
 * The root is the app for anyone signed in: `/` forwards to the dashboard
 * (whose stub picks the last-visited workspace), the way GitHub and Vercel do.
 * The marketing page itself stays reachable at /home for everyone; the in-app
 * brand mark links there. Anonymous visitors see the landing here as before.
 */
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		const { isAuthenticated, isLoading } = useAuthStore.getState();
		if (!isLoading && isAuthenticated) {
			throw redirect({ to: "/dashboard", replace: true });
		}
		// In the installed app a signed-out visitor gets the Get Started deck
		// instead of this page: the landing is eight animated desktop-shaped
		// sections, which is the wrong first screen on a phone. Browsers on a
		// phone still get the landing — it is a marketing page and it should
		// stay linkable and indexable.
		if (Capacitor.isNativePlatform()) {
			throw redirect({ to: "/get-started", replace: true });
		}
	},
	component: LandingPage,
});

export function LandingPage() {
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
