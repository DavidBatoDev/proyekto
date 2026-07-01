import { Button } from "../../ui/button";
import { BrandMark } from "@/components/brand/BrandMark";

const Hero = () => {
  return (
    <section
      id="hero"
      className="w-full min-h-[817px] flex items-center relative overflow-hidden bg-white scroll-mt-32"
    >
      {/* Gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(1200px 600px at -10% -20%, rgba(255, 160, 85, 0.15), rgba(255,255,255,0) 60%)",
        }}
      />

      <div className="container mx-auto px-6 md:px-12 lg:px-14 relative">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-8 sm:gap-12 items-center">
          {/* Left content */}
          <div className="sm:col-span-7">
            <h1 className="text-start text-4xl md:text-6xl lg:text-7xl font-extrabold leading-tight tracking-tight text-gray-900">
              Turn your project idea into action — easily
            </h1>
            <p className="text-start mt-4 text-lg md:text-xl text-gray-600 max-w-2xl">
              Start planning your project step-by-step and invite your team. No complex setups, no guesswork — just clarity from the get-go.
            </p>
            <div className="flex gap-4 mt-6">
              <Button variant="contained" colorScheme="primary" size="lg">
                HIRE A VETTED TEAM
              </Button>
              <Button variant="outlined" colorScheme="primary" size="lg">
                APPLY AS A TALENT
              </Button>
            </div>
          </div>

          {/* Right illustration */}
          <div className="sm:col-span-5 flex justify-center sm:justify-end">
            <BrandMark
              variant="mark"
              className="h-72 sm:h-80 md:h-96 lg:h-[520px]"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;

