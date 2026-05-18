const Services = () => {
  return (
    <section
      id="services"
      className="relative w-full lg:min-h-[1333px] bg-white py-20 overflow-hidden scroll-mt-32"
    >
      {/* Figma background line art */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            "url('https://www.figma.com/api/mcp/asset/428970e6-9933-4ac3-9ed2-cfd92a88bffe'), url('https://www.figma.com/api/mcp/asset/e4ebf49c-210e-475b-8444-f8e83258df68')",
          backgroundRepeat: "no-repeat, no-repeat",
          backgroundPosition: "center 30%, center 10%",
          backgroundSize: "2000px auto, 2400px auto",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "url('https://www.figma.com/api/mcp/asset/178bb81a-7686-40ef-b0f7-da38dfa9327d')",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          backgroundSize: "1200px 1200px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(1200px 800px at 50% 40%, rgba(255,153,51,0.2), rgba(231,32,116,0.08), transparent 75%)",
        }}
      />

      <div className="container mx-auto px-6 md:px-12 lg:px-24 relative z-10">
        {/* Header Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-20">
          <div>
            <h2 className="text-6xl md:text-7xl font-black text-gray-900 mb-6">
              Our Services.
            </h2>
          </div>
          <div className="flex items-center">
            <p className="text-base text-gray-600 leading-relaxed">
              At Proyekto, we don't just connect you with freelancers; we manage
              the entire delivery lifecycle. By combining expert human oversight
              with AI-driven roadmaps, we ensure your project is built
              correctly, on time, and within budget.
            </p>
          </div>
        </div>

        {/* Services Grid */}
        <div className="space-y-0">
          {/* Service 01 - Left aligned */}
          <div className="relative mb-32 lg:mb-0">
            <div className="absolute -top-6 left-0 lg:left-24 z-20">
              <span className="text-7xl font-black text-pink-500">01</span>
            </div>
            <div className="lg:ml-32 mt-16 bg-white rounded-lg shadow-lg p-8 lg:w-[727.5px] lg:h-[241.5px] flex flex-col justify-center">
              <h3 className="text-2xl font-bold text-orange-500 mb-2">
                Managed Delivery Teams
              </h3>
              <div className="w-16 h-1 bg-orange-500 mb-4"></div>
              <p className="text-gray-600 leading-relaxed">
                We assign a vetted Consultant to every project. They act as your
                technical architect and project manager, handling code reviews
                and daily stand-ups so you don't have to.
              </p>
            </div>
          </div>

          {/* Service 02 - Right aligned */}
          <div className="relative mb-32 lg:mb-0 lg:-mt-16">
            <div className="absolute -top-6 right-0 lg:right-24 z-20">
              <span className="text-7xl font-black text-pink-500">02</span>
            </div>
            <div className="lg:mr-32 lg:ml-auto mt-16 bg-white rounded-lg shadow-lg p-8 lg:w-[727.5px] lg:h-[241.5px] flex flex-col justify-center">
              <h3 className="text-2xl font-bold text-orange-500 mb-2">
                AI-Architected Roadmaps
              </h3>
              <div className="w-16 h-1 bg-orange-500 mb-4"></div>
              <p className="text-gray-600 leading-relaxed">
                Move beyond chaotic to-do lists. Our platform generates dynamic,
                linear roadmaps that organize work into clear phases, linking
                every task directly to a business goal.
              </p>
            </div>
          </div>

          {/* Service 03 - Left aligned */}
          <div className="relative mb-32 lg:mb-0 lg:-mt-16">
            <div className="absolute -top-6 left-0 lg:left-24 z-20">
              <span className="text-7xl font-black text-pink-500">03</span>
            </div>
            <div className="lg:ml-32 mt-16 bg-white rounded-lg shadow-lg p-8 lg:w-[727.5px] lg:h-[241.5px] flex flex-col justify-center">
              <h3 className="text-2xl font-bold text-orange-500 mb-2">
                Elite Talent Staffing
              </h3>
              <div className="w-16 h-1 bg-orange-500 mb-4"></div>
              <p className="text-gray-600 leading-relaxed">
                Access our exclusive "Top 3%" talent pool. We rigorously vet
                every freelancer for technical skill and reliability, instantly
                staffing your roadmap with the perfect builders.
              </p>
            </div>
          </div>

          {/* Service 04 - Right aligned */}
          <div className="relative lg:-mt-16">
            <div className="absolute -top-6 right-0 lg:right-24 z-20">
              <span className="text-7xl font-black text-pink-500">04</span>
            </div>
            <div className="lg:mr-32 lg:ml-auto mt-16 bg-white rounded-lg shadow-lg p-8 lg:w-[727.5px] lg:h-[241.5px] flex flex-col justify-center">
              <h3 className="text-2xl font-bold text-orange-500 mb-2">
                Milestone-Based Escrow
              </h3>
              <div className="w-16 h-1 bg-orange-500 mb-4"></div>
              <p className="text-gray-600 leading-relaxed">
                Financial safety for everyone. We secure project funds in Escrow
                before work begins and automate payouts only when milestones are
                verified and approved.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Services;
