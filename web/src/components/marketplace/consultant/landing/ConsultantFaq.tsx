import { ChevronRight } from "lucide-react";

/**
 * Carried over from the old landing page, minus the seat-billing specifics —
 * pricing is not announced, so the commitment answer stays qualitative.
 * Native <details> rather than component state: the browser already knows how
 * to do an accordion.
 */
const FAQS = [
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
			"You see the reviewer's reason, and you can revise your application and submit it again. Meanwhile you can still use Proyekto as talent or a client.",
	},
	{
		question: "Who owns the work product?",
		answer:
			"Your contract with your client governs. Proyekto is infrastructure — we don't claim IP rights to your deliverables.",
	},
	{
		question: "Is there a minimum commitment?",
		answer:
			"No. There's no exclusivity and no lock-in — your clients and your book stay yours, on the platform or off it.",
	},
	{
		question: "How does Proyekto compare to running my own LLC + tools?",
		answer:
			"You can absolutely run your own stack — most of our consultants did before. The pitch is consolidation: one workspace instead of a dozen tabs, contracts and billing on the same rails as delivery, and a vetted bench so you stop spending Sundays sourcing.",
	},
];

export function ConsultantFaq() {
	return (
		<section className="mx-auto max-w-3xl px-4 pt-20 sm:px-6 lg:pt-24">
			<h2 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				Questions consultants actually ask
			</h2>

			<div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
				{FAQS.map((faq) => (
					<details key={faq.question} className="group px-5 py-4">
						<summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
							{faq.question}
							<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
						</summary>
						<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
							{faq.answer}
						</p>
					</details>
				))}
			</div>
		</section>
	);
}
