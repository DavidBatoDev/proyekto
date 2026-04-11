import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import Logo from "/prodigylogos/light/logo1.svg";
import { useAuthStore } from "@/stores/authStore";
import UserMenu from "../auth/UserMenu";
import { Menu, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

function getInitialHash() {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

export const Header = () => {
  const { isAuthenticated } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState(getInitialHash);

  const navItems = [
    { label: "Use It Your Way", href: "#use-it-your-way" },
    { label: "How It Works", href: "#how-it-works" },
    { label: "Why Proyekto", href: "#why-proyekto" },
    { label: "Templates", href: "#templates" },
    { label: "Features", href: "#features" },
  ];

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncHash = () => setActiveHash(window.location.hash);
    window.addEventListener("hashchange", syncHash);

    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
      <nav className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center gap-6 lg:gap-10">
            <motion.div whileTap={{ scale: 0.97 }} transition={{ duration: 0.15 }}>
              <Link to="/" className="flex shrink-0 items-center">
                <img src={Logo} alt="Proyekto" className="h-11 sm:h-12" />
              </Link>
            </motion.div>

            <div className="hidden md:flex items-center gap-2">
              {navItems.map((item) => (
                <motion.a
                  key={item.href}
                  href={item.href}
                  onClick={() => setActiveHash(item.href)}
                  whileTap={{ scale: 0.95 }}
                  transition={{ duration: 0.12 }}
                  className="relative rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}

                  {activeHash === item.href ? (
                    <motion.span
                      layoutId="header-nav-active"
                      className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-slate-900"
                      transition={{ type: "spring", stiffness: 520, damping: 36 }}
                    />
                  ) : null}
                </motion.a>
              ))}
            </div>
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
                  <span className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 lg:inline-flex">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Roadmap-first platform
                  </span>
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
              <div className="flex flex-col gap-2">
                {navItems.map((item) => (
                  <motion.a
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      setActiveHash(item.href);
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
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </nav>
    </header>
  );
};
