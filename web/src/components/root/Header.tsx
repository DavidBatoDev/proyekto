import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Sparkles } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";
import {
	SECTION_IDS,
	usePresentationContext,
} from "@/contexts/PresentationContext";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/ui/button";
import UserMenu from "../auth/UserMenu";

const NAV_ITEMS = [
	{ label: "Use It Your Way", sectionIndex: 1 },
	{ label: "How It Works", sectionIndex: 2 },
	{ label: "Why Proyekto", sectionIndex: 4 },
	{ label: "Templates", sectionIndex: 5 },
	{ label: "Features", sectionIndex: 6 },
] as const;

const HEADER_THEME = {
	bg: "bg-background/90 backdrop-blur-xl",
	border: "border-border",
	text: "text-muted-foreground",
	logo: "text-primary",
};

const navContainerVariants = {
	hidden: {},
	show: {
		transition: { staggerChildren: 0.05, delayChildren: 0.1 },
	},
};

const navItemVariants = {
	hidden: { opacity: 0, y: -6 },
	show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

export const Header = () => {
	const { isAuthenticated } = useAuthStore();
	const navigate = useNavigate();
	const location = useLocation();
	const { activeSection, goToSection } = usePresentationContext();

	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [hoveredItem, setHoveredItem] = useState<number | null>(null);

	const theme = HEADER_THEME;
	const isLandingPage = location.pathname === "/";

	const openLandingSection = (sectionIndex: number) => {
		if (isLandingPage) {
			goToSection(sectionIndex);
			return;
		}
		void navigate({ to: "/", hash: SECTION_IDS[sectionIndex] });
	};

	const handleNavClick = (e: React.MouseEvent, sectionIndex: number) => {
		e.preventDefault();
		openLandingSection(sectionIndex);
		setMobileMenuOpen(false);
	};

	const handleLogoClick = () => {
		if (isLandingPage) goToSection(0);
		else void navigate({ to: "/" });
		setMobileMenuOpen(false);
	};

	return (
		<motion.header
			className={`fixed left-0 right-0 top-0 z-50 border-b transition-colors duration-300 ${theme.bg} ${theme.border}`}
			animate={{ opacity: 1 }}
		>
			<nav className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
				<div className="flex h-20 items-center justify-between">
					<div className="flex items-center gap-6 lg:gap-10">
						<motion.div
							whileTap={{ scale: 0.97 }}
							transition={{ duration: 0.15 }}
						>
							<button
								className="flex shrink-0 items-center cursor-pointer"
								onClick={handleLogoClick}
								type="button"
							>
								<BrandMark
									className={`h-11 sm:h-12 transition-colors duration-300 ${theme.logo}`}
								/>
							</button>
						</motion.div>

						<motion.div
							className="hidden md:flex items-center gap-2"
							variants={navContainerVariants}
							initial="hidden"
							animate="show"
						>
							{NAV_ITEMS.map((item) => (
								<motion.button
									key={item.sectionIndex}
									type="button"
									variants={navItemVariants}
									onClick={(e) => handleNavClick(e, item.sectionIndex)}
									onHoverStart={() => setHoveredItem(item.sectionIndex)}
									onHoverEnd={() => setHoveredItem(null)}
									whileTap={{ scale: 0.95 }}
									transition={{ duration: 0.12 }}
									className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${theme.text} hover:opacity-100`}
								>
									{hoveredItem === item.sectionIndex && (
										<motion.span
											layoutId="nav-pill"
											className="absolute inset-0 rounded-lg bg-white/10"
											transition={{
												type: "spring",
												stiffness: 400,
												damping: 35,
											}}
										/>
									)}
									<span className="relative z-10">{item.label}</span>
									{activeSection === item.sectionIndex ? (
										<motion.span
											layoutId="header-nav-active"
											className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-current"
											transition={{
												type: "spring",
												stiffness: 520,
												damping: 36,
											}}
										/>
									) : null}
								</motion.button>
							))}
						</motion.div>
					</div>

					<div className="flex items-center gap-3">
						<div className="hidden md:flex items-center gap-3">
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
												className="h-11 rounded-xl px-5 text-sm"
											>
												Dashboard
											</Button>
										</Link>
									</motion.div>
								</>
							) : (
								<>
									<motion.div
										whileTap={{ scale: 0.97 }}
										transition={{ duration: 0.15 }}
										className="hidden lg:block"
									>
										<Link
											to="/consultant"
											preload="intent"
											className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold transition-colors hover:bg-muted"
										>
											<Sparkles className="h-3.5 w-3.5 text-amber-400" />
											<span className={theme.text}>Apply as a consultant</span>
										</Link>
									</motion.div>
									<motion.div
										whileTap={{ scale: 0.97 }}
										transition={{ duration: 0.15 }}
									>
										<button
											type="button"
											onClick={() => void navigate({ to: "/auth/login" })}
											className={`h-11 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:bg-muted ${theme.text}`}
										>
											Login
										</button>
									</motion.div>
									<motion.div
										whileTap={{ scale: 0.97 }}
										transition={{ duration: 0.15 }}
									>
										<Link to="/auth/signup" search={{ redirect: undefined }}>
											<Button
												variant="contained"
												colorScheme="primary"
												className="h-11 rounded-xl px-5"
											>
												Get Started
											</Button>
										</Link>
									</motion.div>
								</>
							)}
						</div>

						<motion.button
							className={`rounded-lg p-2 hover:bg-muted md:hidden ${theme.text}`}
							onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
							aria-label="Open navigation"
							whileTap={{ scale: 0.92, rotate: -5 }}
							transition={{ duration: 0.12 }}
						>
							<Menu className="h-6 w-6" />
						</motion.button>
					</div>
				</div>

				<AnimatePresence initial={false}>
					{mobileMenuOpen ? (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							transition={{ duration: 0.2, ease: "easeOut" }}
							className={`overflow-hidden border-t py-4 md:hidden ${theme.border}`}
						>
							<motion.div
								className="flex flex-col gap-2"
								variants={navContainerVariants}
								initial="hidden"
								animate="show"
							>
								{NAV_ITEMS.map((item) => (
									<motion.button
										key={item.sectionIndex}
										type="button"
										variants={navItemVariants}
										className={`rounded-lg px-2 py-2 text-left text-sm font-medium hover:bg-muted ${theme.text}`}
										onClick={(e) => handleNavClick(e, item.sectionIndex)}
										whileTap={{ scale: 0.97 }}
										transition={{ duration: 0.1 }}
									>
										{item.label}
									</motion.button>
								))}

								<div className={`mt-2 border-t pt-3 ${theme.border}`}>
									{isAuthenticated ? (
										<motion.div
											whileTap={{ scale: 0.98 }}
											transition={{ duration: 0.12 }}
										>
											<Link to="/dashboard">
												<Button
													variant="contained"
													colorScheme="primary"
													className="w-full rounded-xl"
												>
													Dashboard
												</Button>
											</Link>
										</motion.div>
									) : (
										<div className="grid grid-cols-2 gap-2">
											<motion.div
												whileTap={{ scale: 0.98 }}
												transition={{ duration: 0.12 }}
											>
												<Link to="/auth/login">
													<Button
														variant="outlined"
														colorScheme="primary"
														className="w-full rounded-xl border-border text-foreground hover:bg-muted"
													>
														Login
													</Button>
												</Link>
											</motion.div>
											<motion.div
												whileTap={{ scale: 0.98 }}
												transition={{ duration: 0.12 }}
											>
												<Link
													to="/auth/signup"
													search={{ redirect: undefined }}
												>
													<Button
														variant="contained"
														colorScheme="primary"
														className="w-full rounded-xl"
													>
														Get Started
													</Button>
												</Link>
											</motion.div>
										</div>
									)}
								</div>
							</motion.div>
						</motion.div>
					) : null}
				</AnimatePresence>
			</nav>
		</motion.header>
	);
};
