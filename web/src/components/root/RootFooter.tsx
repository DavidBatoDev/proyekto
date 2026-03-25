import Logo from "/prodigylogos/light/logo1.svg";

export const RootFooter = () => {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div>
            <img src={Logo} alt="Proyekto" className="mb-4 h-10" />
            <p className="text-sm text-slate-600">
              The roadmap operating system for teams that want strategic clarity and faster execution.
            </p>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">Platform</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Roadmap Studio</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Consultant Matching</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Execution Layer</button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">Resources</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Case Studies</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Playbooks</button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">Roadmap Guides</button>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-slate-900">Company</h4>
            <ul className="space-y-2 text-sm text-slate-600">
              <li>
                <button type="button" className="transition-colors hover:text-slate-900">About Proyekto</button>
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
