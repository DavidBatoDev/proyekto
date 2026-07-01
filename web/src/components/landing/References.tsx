const References = () => {
  return (
    <section className="w-full  bg-linear-to-br from-orange-50 via-pink-50 to-white py-20">
      <div className="container mx-auto px-6 md:px-12 lg:px-24">
        {/* Header Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          <div>
            <h2 className="text-6xl md:text-7xl font-black text-gray-900 mb-6">
              Proven Results.
            </h2>
          </div>
          <div className="flex flex-col justify-center">
            <p className="text-base text-gray-600 leading-relaxed mb-6">
              Our managed approach eliminates the risks of remote development. See
              how Proyekto Consultants have helped businesses ship complex software
              on time and without the chaos.
            </p>
            <button className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-6 py-3 rounded-lg w-fit transition-colors">
              Apply as a Consultant
            </button>
          </div>
        </div>

        {/* Case Studies Grid - 2x2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          {/* Top Left - Healthcare Data Migration */}
          <div className="flex flex-col lg:flex-row lg:h-[412px] overflow-hidden">
            <div
              className="w-full lg:w-1/2 min-h-[250px] lg:h-full bg-cover bg-center"
              style={{
                backgroundColor: "#D9D9D9",
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&h=600&fit=crop&q=80')",
              }}
              role="img"
              aria-label="Healthcare data migration case study"
            ></div>
            <div className="w-full lg:w-1/2 bg-transparent p-8 flex flex-col justify-between lg:h-full">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  Healthcare Data Migration.
                </h3>
                <p className="text-gray-600 leading-relaxed mb-6">
                  A clinic network needed to move to the cloud securely. Their dedicated Proyekto team handled HIPAA compliance and executed a zero-downtime migration.
                </p>
              </div>
              <div className="flex justify-end">
                <button className="flex items-center gap-2 text-gray-900 font-semibold hover:gap-4 transition-all">
                  Read More <span>→</span>
                </button>
              </div>
            </div>
          </div>

          {/* Top Right - E-Commerce Re-Platforming */}
          <div className="flex flex-col lg:flex-row lg:h-[412px] overflow-hidden">
            <div
              className="w-full lg:w-1/2 min-h-[250px] lg:h-full bg-cover bg-center"
              style={{
                backgroundColor: "#D9D9D9",
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop&q=80')",
              }}
              role="img"
              aria-label="E-commerce re-platforming case study"
            ></div>
            <div className="w-full lg:w-1/2 bg-transparent p-8 flex flex-col justify-between lg:h-full">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  E-Commerce Re-Platforming.
                </h3>
                <p className="text-gray-600 leading-relaxed mb-6">
                  A retail brand needed to handle Black Friday traffic. Our vetted Senior DevOps engineers optimized their infrastructure to handle 50x concurrent users.
                </p>
              </div>
              <div className="flex justify-end">
                <button className="flex items-center gap-2 text-gray-900 font-semibold hover:gap-4 transition-all">
                  Read More <span>→</span>
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Left - Fintech App Launch */}
          <div className="flex flex-col lg:flex-row-reverse lg:h-[412px] overflow-hidden">
            <div
              className="w-full lg:w-1/2 min-h-[250px] lg:h-full bg-cover bg-center"
              style={{
                backgroundColor: "#D9D9D9",
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=800&h=600&fit=crop&q=80')",
              }}
              role="img"
              aria-label="Fintech app launch case study"
            ></div>
            <div className="w-full lg:w-1/2 bg-transparent p-8 flex flex-col justify-between lg:h-full">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  Fintech App Launch.
                </h3>
                <p className="text-gray-600 leading-relaxed mb-6">
                  A unified payments startup was struggling with technical debt. A Proyekto architect took control, restructured the team, and shipped the MVP in just 6 weeks.
                </p>
              </div>
              <div className="flex justify-end">
                <button className="flex items-center gap-2 text-gray-900 font-semibold hover:gap-4 transition-all">
                  Read More <span>→</span>
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Right - SaaS MVP Under Budget */}
          <div className="flex flex-col lg:flex-row-reverse lg:h-[412px] overflow-hidden">
            <div
              className="w-full lg:w-1/2 min-h-[250px] lg:h-full bg-cover bg-center"
              style={{
                backgroundColor: "#D9D9D9",
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop&q=80')",
              }}
              role="img"
              aria-label="SaaS MVP under budget case study"
            ></div>
            <div className="w-full lg:w-1/2 bg-transparent p-8 flex flex-col justify-between lg:h-full">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">
                  SaaS MVP Under Budget.
                </h3>
                <p className="text-gray-600 leading-relaxed mb-6">
                  By using Proyekto's Linear Roadmap, a logistics founder eliminated vague requirements. The project finished with $15k saved in avoided "scope creep."
                </p>
              </div>
              <div className="flex justify-end">
                <button className="flex items-center gap-2 text-gray-900 font-semibold hover:gap-4 transition-all">
                  Read More <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default References;
