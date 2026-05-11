import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import { useAuthStore } from "@/stores/authStore";
import UserMenu from "../auth/UserMenu";
import { Menu, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const NAV_ITEMS = [
  { label: "Use It Your Way", href: "#use-it-your-way" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Why Proyekto", href: "#why-proyekto" },
  { label: "Templates", href: "#templates" },
  { label: "Features", href: "#features" },
];

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

function getInitialHash() {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

export const Header = () => {
  const { isAuthenticated } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const isHomePage = location.pathname === "/";

  const handleNavClick = (e: React.MouseEvent, href: string) => {
    e.preventDefault();
    setActiveHash(href);
    const sectionId = href.replace("#", "");

    if (isHomePage) {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/#${sectionId}`);
      }
      return;
    }

    void navigate({ to: "/", hash: sectionId });
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState(getInitialHash);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  useEffect(() => {
    if (!isHomePage) {
      setActiveHash("");
    }
  }, [isHomePage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncHash = () => setActiveHash(window.location.hash);
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    NAV_ITEMS.forEach(({ href }) => {
      const el = document.getElementById(href.replace("#", ""));
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveHash(href);
        },
        { threshold: 0.3, rootMargin: "-80px 0px -40% 0px" },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((obs) => obs.disconnect());
  }, []);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
      <nav className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center gap-6 lg:gap-10">
            <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
              <Link
                to="/"
                preload="intent"
                className="flex shrink-0 items-center"
                onClick={() => setActiveHash("")}
              >
                <BrandMark className="h-11 sm:h-12 text-slate-900" />
              </Link>
            </motion.div>

            <motion.div
              className="hidden md:flex items-center gap-2"
              variants={navContainerVariants}
              initial="hidden"
              animate="show"
            >
              {NAV_ITEMS.map((item) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  variants={navItemVariants}
                  onClick={(e) => handleNavClick(e, item.href)}
                  onHoverStart={() => setHoveredItem(item.href)}
                  onHoverEnd={() => setHoveredItem(null)}
                  whileTap={{ scale: 0.95, color: "#0f172a" }}
                  transition={{ duration: 0.12 }}
                  className="relative rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
                >
                  {hoveredItem === item.href && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-lg bg-slate-100"
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    />
                  )}

                  <span className="relative z-10">{item.label}</span>

                  {activeHash === item.href ? (
                    <motion.span
                      layoutId="header-nav-active"
                      className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-slate-900"
                      transition={{ type: "spring", stiffness: 520, damping: 36 }}
                    />
                  ) : null}
                </motion.a>
              ))}
            </motion.div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <UserMenu />
                  <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                    <Link to="/dashboard">
                      <Button variant="contained" colorScheme="primary" className="h-11 rounded-xl px-5 text-sm">
                        Dashboard
                      </Button>
                    </Link>
                  </motion.div>
                </>
              ) : (
                <>
                  <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }} className="hidden lg:block">
                    <Link
                      to="/consultant"
                      preload="intent"
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-slate-900 hover:bg-white hover:text-slate-900"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Apply as a consultant
                    </Link>
                  </motion.div>
                  <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                    <Link to="/auth/login">
                      <Button variant="outlined" colorScheme="primary" className="h-11 rounded-xl border-slate-300 text-slate-700 hover:border-slate-900 hover:bg-slate-900 hover:text-white">
                        Login
                      </Button>
                    </Link>
                  </motion.div>
                  <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
                    <Link to="/auth/signup" search={{ redirect: undefined }}>
                      <Button variant="contained" colorScheme="primary" className="h-11 rounded-xl bg-slate-900 px-5 text-white hover:bg-slate-800">
                        Get Started
                      </Button>
                    </Link>
                  </motion.div>
                </>
              )}
            </div>

            <motion.button
              className="rounded-lg p-2 hover:bg-slate-100 md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Open navigation"
              whileTap={{ scale: 0.92, rotate: -5 }}
              transition={{ duration: 0.12 }}
            >
              <Menu className="h-6 w-6 text-slate-700" />
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
              className="overflow-hidden border-t border-slate-200 py-4 md:hidden"
            >
              <motion.div
                className="flex flex-col gap-2"
                variants={navContainerVariants}
                initial="hidden"
                animate="show"
              >
                {NAV_ITEMS.map((item) => (
                  <motion.a
                    key={item.href}
                    href={item.href}
                    variants={navItemVariants}
                    className="rounded-lg px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    onClick={(e) => {
                      handleNavClick(e, item.href);
                      setMobileMenuOpen(false);
                    }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ duration: 0.1 }}
                  >
                    {item.label}
                  </motion.a>
                ))}

                <div className="mt-2 border-t border-slate-200 pt-3">
                  {isAuthenticated ? (
                    <motion.div whileTap={{ scale: 0.98 }} transition={{ duration: 0.12 }}>
                      <Link to="/dashboard">
                        <Button
                          variant="contained"
                          colorScheme="primary"
                          className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                        >
                          Dashboard
                        </Button>
                      </Link>
                    </motion.div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <motion.div whileTap={{ scale: 0.98 }} transition={{ duration: 0.12 }}>
                        <Link to="/auth/login">
                          <Button
                            variant="outlined"
                            colorScheme="primary"
                            className="w-full rounded-xl border-slate-300 text-slate-700 hover:bg-slate-900 hover:text-white"
                          >
                            Login
                          </Button>
                        </Link>
                      </motion.div>
                      <motion.div whileTap={{ scale: 0.98 }} transition={{ duration: 0.12 }}>
                        <Link to="/auth/signup" search={{ redirect: undefined }}>
                          <Button
                            variant="contained"
                            colorScheme="primary"
                            className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
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
    </header>
  );
};
