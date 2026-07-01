import { Button } from "../../ui/button";

const CTA = () => {
  return (
    <section
      id="cta"
      className="relative w-full overflow-hidden py-16 md:py-20 flex justify-center bg-white scroll-mt-32"
    >
      <div
        className="relative w-full max-w-[1313px] overflow-hidden min-h-[520px] rounded-[7.5px] px-8 md:px-14 lg:px-20 py-12 md:py-16"
        style={{
          backgroundImage:
            "linear-gradient(91deg, rgba(231,32,116,0.35) 0%, rgba(255,255,255,0.9) 50%, rgba(255,153,51,0.35) 100%)",
        }}
      >
        <div className="relative flex flex-col items-center text-center gap-6 md:gap-8 max-w-3xl mx-auto">
          <div className="text-base text-gray-900">
            <span className="font-semibold text-primary">Pro</span>fessional.{" "}
            <span className="font-semibold text-primary">Pro</span>ductive.{" "}
            <span className="font-semibold text-primary">Pro</span>digy.
          </div>

          <h2 className="text-4xl md:text-5xl font-black text-gray-900 leading-tight">
            Ready to ship your vision?
          </h2>

          <p className="text-base md:text-lg text-gray-800 leading-relaxed">
            Stop managing and start shipping. Join the workspace where expert
            Consultants and elite talent turn your ideas into deployed software.
            Secure your budget, architect your roadmap, and launch with
            confidence.
          </p>

          <Button variant="contained" colorScheme="primary" size="lg">
            Start Building
          </Button>
        </div>
      </div>
    </section>
  );
};

export default CTA;
