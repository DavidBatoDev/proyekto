import { BrandMark } from "@/components/brand/BrandMark";
import FacebookIcon from "@mui/icons-material/Facebook";
import InstagramIcon from "@mui/icons-material/Instagram";
import LinkedInIcon from "@mui/icons-material/LinkedIn";

const Footer = () => {
  return (
    <footer className="w-full bg-[#e7e8ea] border-t border-gray-200">
      <div className="container mx-auto px-6 md:px-12 lg:px-24 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-16">
          {/* Brand and socials */}
          <div className="space-y-4">
            <BrandMark className="h-12 text-primary" />
            <div className="flex items-center gap-4 text-gray-800">
              <a
                aria-label="Facebook"
                className="hover:text-primary transition-colors"
                href="#"
              >
                <FacebookIcon fontSize="medium" />
              </a>
              <a
                aria-label="Instagram"
                className="hover:text-primary transition-colors"
                href="#"
              >
                <InstagramIcon fontSize="medium" />
              </a>
              <a
                aria-label="LinkedIn"
                className="hover:text-primary transition-colors"
                href="#"
              >
                <LinkedInIcon fontSize="medium" />
              </a>
            </div>
            <p className="text-start text-sm text-gray-800">All rights reserved</p>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h4 className="text-primary text-xl font-bold">Quick Links</h4>
            <ul className="space-y-2 text-sm text-gray-800">
              <li>About Us</li>
              <li>Who We Are</li>
              <li>Our Services</li>
              <li>Terms of Use</li>
              <li>Privacy Notice</li>
            </ul>
          </div>

          {/* Contact */}
          <div className="space-y-3">
            <h4 className="text-primary text-xl font-bold">Contact us</h4>
            <ul className="space-y-2 text-sm text-gray-800">
              <li>(+63) 0956 224 8927</li>
              <li>admin@prodigitality.net</li>
              <li>
                66 The Site Plaza Bldg, St Mary Ave,
                <br /> Provident, Marikina City, Metro Manila, Philippines
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
