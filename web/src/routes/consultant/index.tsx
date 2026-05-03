import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Crown,
  HandCoins,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { Button } from "@/ui/button";
import { Header } from "@/components/root/Header";
import { RootFooter } from "@/components/root/RootFooter";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/consultant/")({
  component: ConsultantLandingPage,
});

function ConsultantLandingPage() {
  return (
    <div className="min-h-screen bg-[#fcfcfd]">
      <Header />

      <main className="pb-20 pt-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
          <ConsultantHero />
          <WhoThisIsFor />
          <WhatYouGet />
          <PricingSection />
          <CriteriaSection />
          <FAQSection />
          <FinalCTA />
        </div>
      </main>

      <RootFooter />
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function ConsultantHero() {
  return (
    <section className="relative pt-6 sm:pt-10">
      <div className="pointer-events-none absolute -top-20 left-[10%] h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-indigo-200/50 blur-3xl" />

      <div className="relative mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-300/70 bg-white/85 px-3 py-1.5 text-xs font-semibold tracking-[0.08em] text-slate-700"
        >
          <Crown className="h-3.5 w-3.5 text-amber-600" />
          For independent consultants
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06 }}
          className="mt-5 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
        >
          Run client engagements like a firm.
          <br />
          <span className="text-slate-500">Without the firm.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.12 }}
          className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-slate-600 sm:text-lg"
        >
          Proyekto is the operating system for independent consultants. Bring your clients and your network — we handle the workspace, the vetted talent bench, escrow, and invoicing.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.2 }}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <ApplyButton />
          <a
            href="#what-you-get"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:text-slate-900"
          >
            See what's included
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.26 }}
          className="mt-4 text-xs text-slate-500"
        >
          15-minute application · Most decisions within 5 business days
        </motion.p>
      </div>
    </section>
  );
}

// ─── Who this is for ────────────────────────────────────────────────────────

const personas = [
  {
    icon: Briefcase,
    title: "Fractional leaders",
    description: "Fractional CTOs, heads of product, or ops leads running 2–4 engagements at once.",
  },
  {
    icon: Workflow,
    title: "Freelance consultants",
    description: "Solo consultants who keep getting asked, \"can you bring a team for this?\"",
  },
  {
    icon: Building2,
    title: "Boutique-agency founders",
    description: "Tired of running the back office and ready to ship faster with less overhead.",
  },
  {
    icon: Crown,
    title: "Ex-Big-4 / ex-McKinsey",
    description: "Building independent practice, looking for firm-quality tooling without the firm.",
  },
];

function WhoThisIsFor() {
  return (
    <section className="relative mt-20 lg:mt-24">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          You should be on Proyekto if you're…
        </h2>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          We're selective on purpose. Not a fit if you're new to client-facing delivery.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {personas.map((persona) => {
          const Icon = persona.icon;
          return (
            <article
              key={persona.title}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_18px_rgba(15,23,42,0.05)] transition-all hover:border-slate-900/20 hover:shadow-[0_12px_24px_rgba(15,23,42,0.08)]"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-slate-900">{persona.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{persona.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── What you get ───────────────────────────────────────────────────────────

const benefits = [
  {
    icon: Sparkles,
    title: "Client workspace",
    description:
      "Roadmap canvas, AI planning, chat, files, time tracking, milestone-based escrow. White-glove enough for your enterprise clients.",
  },
  {
    icon: Users,
    title: "Vetted talent bench",
    description:
      "Search and propose freelancers your clients can't see directly. We handle identity, portfolio, and rate verification — you pick.",
  },
  {
    icon: Wallet,
    title: "Built-in commercial layer",
    description:
      "Contracts, escrow, milestones, invoicing, and payouts. Stop chasing wire transfers and reconciling spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Your brand, our infrastructure",
    description:
      "Clients see the work and your name on it. We're the rails — invisible to your client unless they need us.",
  },
  {
    icon: HandCoins,
    title: "Lead pipeline (eventually)",
    description:
      "As we grow on the client side, qualified inbound flows to verified consultants. Your existing book stays yours; new leads are a bonus.",
  },
];

function WhatYouGet() {
  return (
    <section id="what-you-get" className="relative mt-20 lg:mt-24">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(16,24,40,0.06)] sm:p-8 lg:p-10">
        <div className="text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            What's in the consultant subscription
          </h2>
          <p className="mt-3 text-sm text-slate-600 sm:text-base">
            Everything you need to deliver client work like a firm.
          </p>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          {benefits.map((benefit, index) => {
            const Icon = benefit.icon;
            const isFeatured = index === 0;
            return (
              <article
                key={benefit.title}
                className={`rounded-2xl border p-5 sm:p-6 ${
                  isFeatured
                    ? "border-blue-200 bg-linear-to-br from-blue-500 to-blue-600 text-white shadow-[0_12px_24px_rgba(59,130,246,0.25)]"
                    : "border-slate-200 bg-slate-50/60"
                }`}
              >
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${
                    isFeatured
                      ? "border-white/30 bg-white/15 text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3
                  className={`mt-4 text-lg font-semibold ${
                    isFeatured ? "text-white" : "text-slate-900"
                  }`}
                >
                  {benefit.title}
                </h3>
                <p
                  className={`mt-2 text-sm leading-relaxed ${
                    isFeatured ? "text-blue-50" : "text-slate-600"
                  }`}
                >
                  {benefit.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ────────────────────────────────────────────────────────────────

function PricingSection() {
  return (
    <section className="relative mt-20 lg:mt-24">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Pricing
        </h2>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          We make money when your projects ship — that's the alignment.
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_8px_18px_rgba(15,23,42,0.05)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Consultant seat
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-900">
            <span className="text-slate-400">$</span>TBD
            <span className="ml-1 text-base font-medium text-slate-500">/ month</span>
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Per consultant. Cancel anytime.
          </p>

          <ul className="mt-6 space-y-3 text-sm text-slate-600">
            {[
              "Client workspace with roadmap, chat, files",
              "Access to the full vetted talent bench",
              "Escrow, contracts, milestones, payouts",
              "Your brand on every client surface",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-3xl border border-slate-900/10 bg-slate-900 p-6 text-white shadow-[0_12px_30px_rgba(15,23,42,0.25)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-300">
            Platform fee
          </p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-white">
            TBD<span className="ml-1 text-3xl">%</span>
          </p>
          <p className="mt-2 text-sm text-slate-300">
            On freelancer payouts you route through Proyekto.
          </p>

          <ul className="mt-6 space-y-3 text-sm text-slate-200">
            {[
              "No fee on your own consulting hours",
              "No fee on flat-fee deliverables you bill direct",
              "Transparent — your client sees the same breakdown",
              "Aligned with your delivery, not your retainer",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

// ─── Criteria ───────────────────────────────────────────────────────────────

const criteria = [
  {
    title: "5+ years of independent delivery",
    description:
      "Independent consulting, freelance, or fractional leadership experience. Direct client-facing.",
  },
  {
    title: "At least one verifiable engagement at $25k+",
    description:
      "We'll ask for references and a brief case write-up of the most representative project.",
  },
  {
    title: "References from past clients or collaborators",
    description:
      "Two minimum. We do quick reference calls — no big deal, just sanity-checking the story.",
  },
  {
    title: "A point of view",
    description:
      "We want consultants who say no to bad projects, not yes to everything. Opinions over hustle.",
  },
];

function CriteriaSection() {
  return (
    <section className="relative mt-20 lg:mt-24">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          What we look for
        </h2>
        <p className="mt-3 text-sm text-slate-600 sm:text-base">
          Every application is reviewed by a human. Most consultants hear back within 5 business days.
        </p>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {criteria.map((item, index) => (
          <article
            key={item.title}
            className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_18px_rgba(15,23,42,0.05)]"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────

const faqs = [
  {
    question: "Can I bring my existing clients?",
    answer:
      "Yes — and you should. The platform is yours to run your book through. No exclusivity, no client poaching.",
  },
  {
    question: "Do my clients have to sign up separately?",
    answer:
      "They get a client account when you invite them. It's free for them; the workspace lives under your brand.",
  },
  {
    question: "What happens if I'm not approved?",
    answer:
      "You can still use Proyekto as a freelancer or client. We re-review applications every 6 months.",
  },
  {
    question: "Who owns the work product?",
    answer:
      "Your contract with your client governs. Proyekto is infrastructure — we don't claim IP rights to your deliverables.",
  },
  {
    question: "Is there a minimum commitment?",
    answer:
      "No. The consultant seat is month-to-month. Cancel anytime; you keep access through the end of your billing period.",
  },
  {
    question: "How does Proyekto compare to running my own LLC + tools?",
    answer:
      "You can absolutely run your own stack — most of our consultants did before. The pitch is consolidation: one bill instead of six, one workspace instead of a dozen tabs, and a vetted bench so you stop spending Sundays on Upwork.",
  },
];

function FAQSection() {
  return (
    <section className="relative mt-20 lg:mt-24">
      <div className="text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Common questions
        </h2>
      </div>

      <div className="mx-auto mt-10 max-w-3xl space-y-3">
        {faqs.map((faq) => (
          <details
            key={faq.question}
            className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition-all hover:border-slate-300 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-4 text-left text-base font-semibold text-slate-900">
              {faq.question}
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="mt-20">
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 p-6 [box-shadow:inset_0_0_140px_rgba(255,255,255,0.08),0_18px_40px_rgba(15,23,42,0.4)] sm:p-10 lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(245,158,11,0.18),transparent_40%),radial-gradient(circle_at_84%_72%,rgba(59,130,246,0.22),transparent_45%)]" />

        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Ready to run engagements like a firm?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            15-minute application. Most decisions within 5 business days. No BS.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ApplyButton dark />
            <Link
              to="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition-all hover:border-white/60 hover:bg-white/10"
            >
              Back to homepage
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Apply button (auth-aware) ──────────────────────────────────────────────

function ApplyButton({ dark = false }: { dark?: boolean }) {
  const { isAuthenticated } = useAuthStore();

  const className = dark
    ? "rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-[0_14px_30px_rgba(0,0,0,0.3)] hover:bg-slate-100"
    : "rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(15,23,42,0.26)] hover:bg-slate-800";

  if (isAuthenticated) {
    return (
      <Link to="/consultant/apply">
        <Button variant="contained" colorScheme="primary" className={className}>
          Continue your application
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    );
  }

  return (
    <Link to="/auth/signup" search={{ redirect: "/consultant/apply" }}>
      <Button variant="contained" colorScheme="primary" className={className}>
        Apply to lead on Proyekto
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </Link>
  );
}
