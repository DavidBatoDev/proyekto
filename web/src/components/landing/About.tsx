const About = () => {
  return (
    <section
      id="about"
      className="relative w-full min-h-[620px] flex items-center overflow-hidden bg-linear-to-br from-orange-50 via-white to-orange-50 py-20 scroll-mt-32"
    >
      {/* Wave background from Figma */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-36 h-[660px] opacity-80"
        style={{
          backgroundImage:
            "url('https://www.figma.com/api/mcp/asset/ad15367b-fcf4-4987-83a2-e0344809af13')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "2000px 660px",
          backgroundPosition: "center top",
        }}
      />

      {/* Subtle line art */}
      {/* <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-15"
        style={{
          backgroundImage:
            "url('https://www.figma.com/api/mcp/asset/401294d3-a0ee-4f4c-8db8-a104e5af9bfc'), url('https://www.figma.com/api/mcp/asset/8487b178-52f2-4e6e-b3be-b20653ae46fb')",
          backgroundRepeat: "no-repeat, no-repeat",
          backgroundPosition: "50% 40%, 50% 10%",
          backgroundSize: "1600px auto, 1900px auto",
        }}
      /> */}

      <div className="container mx-auto px-6 md:px-12 lg:px-24 relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left side - Rotated card with vertical text */}
          <div className="flex justify-center lg:justify-start relative">
            <div
              className="relative bg-gray-800 flex items-center justify-start shadow-xl"
              style={{
                width: "497.508px",
                height: "333.767px",
                transform: "rotate(5.99deg)",
                transformOrigin: "center",
              }}
            >
              <div
                className="text-white font-bold uppercase"
                style={{
                  writingMode: "vertical-rl",
                  transform: "rotate(-180.095deg)",
                  fontSize: "42px",
                  lineHeight: "71px",
                  letterSpacing: "1px",
                }}
              >
                PROYEKTO
              </div>
            </div>
          </div>

          {/* Right side - Content */}
          <div className="text-start space-y-6">
            <p className="text-sm font-semibold tracking-widest text-gray-600 uppercase">
              About Us
            </p>
            <h2 className="text-5xl md:text-6xl font-black text-gray-900">
              Who We Are
            </h2>
            <p className="text-lg text-gray-700 leading-relaxed">
              <span className="text-orange-500 font-semibold">Pro</span>
              fessional.{" "}
              <span className="text-orange-500 font-semibold">
                Pro
              </span>ductive.{" "}
              <span className="text-orange-500 font-semibold">Pro</span>yekto.
              The new standard for managed delivery.
            </p>
            <p className="text-base text-gray-600 leading-relaxed">
              Proyekto is the first managed work hub designed for high-stakes
              delivery. We bridge the gap between open marketplaces and
              traditional agencies by integrating expert project management
              directly into the workflow.
            </p>
            <p className="text-base text-gray-600 leading-relaxed">
              We combine top-tier talent with AI-driven oversight to ensure
              clarity, security, and velocity. With Proyekto, you don't just hire
              a freelancer; you deploy a fully managed, architectural-grade
              team.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default About;
