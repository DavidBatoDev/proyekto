import { Link } from "@tanstack/react-router";
import { Button } from "@/ui/button";
import Logo from "/prodigylogos/light/logo1.svg";
import { useAuthStore } from "@/stores/authStore";
import UserMenu from "../auth/UserMenu";
import { Menu, Sparkles } from "lucide-react";
import { useState } from "react";

export const Header = () => {
  const { isAuthenticated } = useAuthStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { label: "How It Works", href: "#how-it-works" },
    { label: "Product Experience", href: "#product-experience" },
    { label: "Templates", href: "#templates" },
    { label: "Your Roadmap", href: "#your-roadmap" },
  ];

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
      <nav className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-10">
        <div className="flex h-20 items-center justify-between">
          <div className="flex items-center gap-6 lg:gap-10">
            <Link to="/" className="flex items-center shrink-0">
              <img src={Logo} alt="Proyekto" className="h-11 sm:h-12" />
            </Link>

            <div className="hidden md:flex items-center gap-2">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <UserMenu />
                  <Link to="/dashboard">
                    <Button variant="contained" colorScheme="primary" className="h-11 rounded-xl px-5 text-sm">
                      Dashboard
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <span className="hidden items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 lg:inline-flex">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Roadmap-first platform
                  </span>
                  <Link to="/auth/login">
                    <Button variant="outlined" colorScheme="primary" className="h-11 rounded-xl border-slate-300 text-slate-700 hover:border-slate-900 hover:bg-slate-900 hover:text-white">
                      Login
                    </Button>
                  </Link>
                  <Link to="/auth/signup" search={{ redirect: undefined }}>
                    <Button variant="contained" colorScheme="primary" className="h-11 rounded-xl bg-slate-900 px-5 text-white hover:bg-slate-800">
                      Get Started
                    </Button>
                  </Link>
                </>
              )}
            </div>

            <button
              className="rounded-lg p-2 hover:bg-slate-100 md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Open navigation"
            >
              <Menu className="h-6 w-6 text-slate-700" />
            </button>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-slate-200 py-4 md:hidden">
            <div className="flex flex-col gap-2">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-2 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}

              <div className="mt-2 border-t border-slate-200 pt-3">
                {isAuthenticated ? (
                  <Link to="/dashboard">
                    <Button
                      variant="contained"
                      colorScheme="primary"
                      className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                    >
                      Dashboard
                    </Button>
                  </Link>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Link to="/auth/login">
                      <Button
                        variant="outlined"
                        colorScheme="primary"
                        className="w-full rounded-xl border-slate-300 text-slate-700 hover:bg-slate-900 hover:text-white"
                      >
                        Login
                      </Button>
                    </Link>
                    <Link to="/auth/signup" search={{ redirect: undefined }}>
                      <Button
                        variant="contained"
                        colorScheme="primary"
                        className="w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800"
                      >
                        Get Started
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </nav>
    </header>
  );
};
