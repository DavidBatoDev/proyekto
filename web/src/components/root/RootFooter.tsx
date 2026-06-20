import { Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand/BrandMark";

export const RootFooter = () => {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-5">
          <div className="md:col-span-2">
            <BrandMark className="mb-4 h-10 text-primary" />
            <p className="max-w-sm text-sm text-slate-600">
              Turn your ideas into action, with Proyekto.
            </p>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">For clients</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link
                  to="/auth/signup"
                  search={{ redirect: undefined }}
                  className="transition-colors hover:text-slate-900"
                >
                  Start a project
                </Link>
              </li>
              <li>
                <a href="#how-it-works" className="transition-colors hover:text-slate-900">How it works</a>
              </li>
              <li>
                <a href="#why-proyekto" className="transition-colors hover:text-slate-900">Why Proyekto</a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">For consultants</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <Link
                  to="/consultant"
                  preload="intent"
                  className="font-semibold text-slate-700 transition-colors hover:text-slate-900"
                >
                  Apply to lead
                </Link>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">How it works</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Pricing</button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">Company</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">About</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Security</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Privacy</button>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-200 pt-8 text-center">
          <p className="text-sm text-slate-500">
            © 2026 Proyekto. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};
