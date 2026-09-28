import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import { SiteDrawer } from "@/components/common/SiteDrawer";
import { usePresentationContext } from "@/contexts/PresentationContext";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/ui/button";
import UserMenu from "../auth/UserMenu";

/**
 * The marketing pages, in the order someone evaluating Proyekto would want
 * them: what it is, how it works, what it costs.
 */
const MARKETING_LINKS = [
	{ to: "/product", label: "Product" },
	{ to: "/docs", label: "Docs" },
	{ to: "/pricing", label: "Pricing" },
] as const;

const HEADER_THEME = {
	bg: "bg-background/90 backdrop-blur-xl",
	border: "border-border",
	text: "text-muted-foreground",
};

export const Header = () => {
	const { isAuthenticated } = useAuthStore();
	const [menuOpen, setMenuOpen] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	const { goToSection } = usePresentationContext();
	const isLandingPage = location.pathname === "/";

	const handleLogoClick = () => {
		if (isLandingPage) goToSection(0);
		else void navigate({ to: "/" });
	};

	return (
		<motion.header
			className={`fixed left-0 right-0 top-0 z-50 border-b transition-colors duration-300 ${HEADER_THEME.bg} ${HEADER_THEME.border}`}
			animate={{ opacity: 1 }}
		>
			<div className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-10">
				<motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
					<button
						className="flex shrink-0 cursor-pointer items-center"
						onClick={handleLogoClick}
						type="button"
						aria-label="Proyekto home"
					>
						<BrandMark variant="lockup" className="h-9 sm:h-10" />
					</button>
				</motion.div>

				<div className="flex items-center gap-2 sm:gap-3">
					{isAuthenticated ? (
						<>
							<UserMenu />
							<motion.div
								whileTap={{ scale: 0.97 }}
								transition={{ duration: 0.15 }}
							>
								<Link to="/dashboard">
									<Button
										variant="contained"
										colorScheme="primary"
										className="h-10 rounded-xl px-3 text-sm sm:h-11 sm:px-5"
									>
										Dashboard
									</Button>
								</Link>
							</motion.div>
						</>
					) : (
						<>
							<nav
								aria-label="Marketing"
								className="hidden items-center sm:flex"
							>
								{MARKETING_LINKS.map((item) => (
									<motion.div
										key={item.to}
										whileTap={{ scale: 0.97 }}
										transition={{ duration: 0.15 }}
									>
										<Link
											to={item.to}
											preload="intent"
											className={`inline-flex h-10 items-center rounded-xl px-3 text-sm font-medium transition-colors hover:text-foreground sm:h-11 ${HEADER_THEME.text}`}
										>
											{item.label}
										</Link>
									</motion.div>
								))}
							</nav>

							{/* Below sm the nav above is hidden, so this is the only way to
							    the marketing pages from a phone. A drawer rather than the
							    dropdown that was here before: three links in a 44px-tall
							    popover is a tap target problem, and the drawer has room for
							    the account actions too. */}
							<button
								type="button"
								aria-expanded={menuOpen}
								aria-label="Open menu"
								onClick={() => setMenuOpen(true)}
								className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border transition-colors hover:bg-muted sm:hidden ${HEADER_THEME.text}`}
							>
								<Menu className="h-5 w-5" aria-hidden />
							</button>

							<SiteDrawer
								isOpen={menuOpen}
								onClose={() => setMenuOpen(false)}
								title="Menu"
							>
								<nav aria-label="Marketing" className="space-y-1">
									{MARKETING_LINKS.map((item) => (
										<Link
											key={item.to}
											to={item.to}
											className="block rounded-xl px-3 py-3 text-[15px] font-medium text-foreground transition-colors hover:bg-muted"
										>
											{item.label}
										</Link>
									))}
								</nav>
								<div className="mt-4 space-y-2 border-t border-border pt-4">
									<Link
										to="/auth/login"
										className="flex h-11 items-center justify-center rounded-xl border border-border text-sm font-semibold text-foreground transition-colors hover:bg-muted"
									>
										Login
									</Link>
									<Link
										to="/auth/signup"
										search={{ redirect: undefined }}
										className="flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
									>
										Get Started
									</Link>
								</div>
							</SiteDrawer>

							<motion.div
								whileTap={{ scale: 0.97 }}
								transition={{ duration: 0.15 }}
							>
								<Link
									to="/auth/login"
									className={`inline-flex h-10 items-center rounded-xl border border-border px-3 text-sm font-medium transition-colors hover:bg-muted sm:h-11 sm:px-4 ${HEADER_THEME.text}`}
								>
									Login
								</Link>
							</motion.div>
							<motion.div
								whileTap={{ scale: 0.97 }}
								transition={{ duration: 0.15 }}
							>
								<Link to="/auth/signup" search={{ redirect: undefined }}>
									<Button
										variant="contained"
										colorScheme="primary"
										className="h-10 rounded-xl px-3 text-sm sm:h-11 sm:px-5"
									>
										Get Started
									</Button>
								</Link>
							</motion.div>
						</>
					)}
				</div>
			</div>
		</motion.header>
	);
};
