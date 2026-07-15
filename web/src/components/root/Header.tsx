import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { usePresentationContext } from "@/contexts/PresentationContext";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/ui/button";
import UserMenu from "../auth/UserMenu";

const HEADER_THEME = {
	bg: "bg-background/90 backdrop-blur-xl",
	border: "border-border",
	text: "text-muted-foreground",
	logo: "text-primary",
};

export const Header = () => {
	const { isAuthenticated } = useAuthStore();
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
						<BrandMark
							className={`h-11 transition-colors duration-300 sm:h-12 ${HEADER_THEME.logo}`}
						/>
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
									<span className={HEADER_THEME.text}>
										Apply as a consultant
									</span>
								</Link>
							</motion.div>
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
