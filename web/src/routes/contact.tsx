import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
	type ContactTopic,
	sendContactMessage,
} from "@/services/contact.service";

/**
 * The contact page.
 *
 * Built like `/pricing`: its own slim sticky header, a single reading column,
 * no motion. It is deliberately absent from `Header.tsx` `validPaths` — the app
 * chrome would be wrong above a public page.
 */
export const Route = createFileRoute("/contact")({
	component: ContactPage,
});

const TOPICS: { value: ContactTopic; label: string; hint: string }[] = [
	{
		value: "sales",
		label: "Plans and pricing",
		hint: "Which plan fits, or anything about billing.",
	},
	{
		value: "support",
		label: "Help with Proyekto",
		hint: "Something is not working, or you cannot find it.",
	},
	{
		value: "partnership",
		label: "Partnerships",
		hint: "Working together, or listing on the marketplace.",
	},
	{
		value: "other",
		label: "Something else",
		hint: "Anything that is none of the above.",
	},
];

const FIELD =
	"h-11 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-input focus:ring-2 focus:ring-primary/20";

function ContactPage() {
	useDocumentTitle("Contact");

	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [company, setCompany] = useState("");
	const [topic, setTopic] = useState<ContactTopic>("support");
	const [message, setMessage] = useState("");
	const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
	const [error, setError] = useState<string | null>(null);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setStatus("sending");
		try {
			await sendContactMessage({
				name: name.trim(),
				email: email.trim(),
				topic,
				message: message.trim(),
				...(company.trim() ? { company: company.trim() } : {}),
			});
			setStatus("sent");
		} catch (caught) {
			setStatus("idle");
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	}

	return (
		<div className="min-h-screen bg-background">
			<header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
				<div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
					<Link to="/" aria-label="Proyekto home">
						<BrandMark variant="lockup" className="h-8" />
					</Link>
					<div className="flex items-center gap-2">
						<Link
							to="/docs"
							className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
						>
							Docs
						</Link>
						<Link
							to="/auth/signup"
							search={{ redirect: undefined }}
							className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
						>
							Get started
						</Link>
					</div>
				</div>
			</header>

			<main className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
				<section className="pb-10 pt-16 sm:pt-20">
					<h1 className="text-4xl font-bold tracking-tight text-foreground">
						Contact us
					</h1>
					<p className="mt-3 max-w-xl text-base text-muted-foreground">
						Tell us what you were trying to do. A real person reads these, and
						we reply to the address you give us.
					</p>
				</section>

				<div className="grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1fr)_280px]">
					<div>
						{status === "sent" ? (
							<div className="rounded-2xl border border-border bg-muted/40 px-6 py-10 text-center">
								<h2 className="text-lg font-semibold text-foreground">
									Thanks — that's with us
								</h2>
								<p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
									We'll reply to {email.trim()}. If it is urgent and you do not
									hear back, send it again — we would rather have it twice than
									not at all.
								</p>
								<Link
									to="/docs"
									className="mt-6 inline-flex h-10 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
								>
									Browse the docs
								</Link>
							</div>
						) : (
							<form onSubmit={submit} className="space-y-6">
								<div className="grid gap-4 sm:grid-cols-2">
									<label className="block">
										<span className="text-sm font-medium text-foreground">
											Your name
										</span>
										<input
											required
											value={name}
											onChange={(e) => setName(e.target.value)}
											className={`mt-1.5 ${FIELD}`}
											autoComplete="name"
										/>
									</label>
									<label className="block">
										<span className="text-sm font-medium text-foreground">
											Email
										</span>
										<input
											required
											type="email"
											value={email}
											onChange={(e) => setEmail(e.target.value)}
											className={`mt-1.5 ${FIELD}`}
											autoComplete="email"
										/>
									</label>
								</div>

								<label className="block">
									<span className="text-sm font-medium text-foreground">
										Company{" "}
										<span className="font-normal text-muted-foreground">
											(optional)
										</span>
									</span>
									<input
										value={company}
										onChange={(e) => setCompany(e.target.value)}
										className={`mt-1.5 ${FIELD}`}
										autoComplete="organization"
									/>
								</label>

								<fieldset>
									<legend className="text-sm font-medium text-foreground">
										What is this about?
									</legend>
									<div className="mt-2 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
										{TOPICS.map((option) => (
											<label
												key={option.value}
												className={`flex cursor-pointer items-start gap-2.5 bg-background p-3.5 transition-colors ${
													topic === option.value
														? "bg-muted/60"
														: "hover:bg-muted/30"
												}`}
											>
												<input
													type="radio"
													name="topic"
													value={option.value}
													checked={topic === option.value}
													onChange={() => setTopic(option.value)}
													className="mt-0.5 accent-primary"
												/>
												<span>
													<span className="block text-sm font-medium text-foreground">
														{option.label}
													</span>
													<span className="mt-0.5 block text-xs text-muted-foreground">
														{option.hint}
													</span>
												</span>
											</label>
										))}
									</div>
								</fieldset>

								<label className="block">
									<span className="text-sm font-medium text-foreground">
										Message
									</span>
									<textarea
										required
										rows={7}
										value={message}
										onChange={(e) => setMessage(e.target.value)}
										placeholder="What were you trying to do, and what happened instead?"
										className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-input focus:ring-2 focus:ring-primary/20"
									/>
								</label>

								{error ? (
									<p role="alert" className="text-sm text-destructive">
										{error}
									</p>
								) : null}

								<button
									type="submit"
									disabled={status === "sending"}
									className="inline-flex h-11 items-center rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
								>
									{status === "sending" ? "Sending…" : "Send message"}
								</button>
							</form>
						)}
					</div>

					<aside className="space-y-8 lg:pt-1">
						<div>
							<h2 className="text-sm font-semibold text-foreground">
								Try the docs first
							</h2>
							<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
								Most questions have an answer written down already — how plans
								and limits work, who can see what, and what the assistant will
								and will not change on its own.
							</p>
							<Link
								to="/docs"
								className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-4 hover:no-underline"
							>
								Browse the documentation
							</Link>
						</div>

						<div>
							<h2 className="text-sm font-semibold text-foreground">
								What happens next
							</h2>
							<p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
								Your message goes to the team, with your address as the reply-to
								— so a reply lands in your inbox rather than somewhere you have
								to log in to find.
							</p>
						</div>
					</aside>
				</div>
			</main>
		</div>
	);
}
