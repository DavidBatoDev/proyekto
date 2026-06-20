import { Link } from "@tanstack/react-router";
import { AppBar, Toolbar, Box, Typography, Stack } from "@mui/material";
import clsx from "clsx";
import { Button } from "../../ui/button";
import { BrandMark } from "@/components/brand/BrandMark";
import { useAuthStore } from "@/stores/authStore";
import UserMenu from "../auth/UserMenu";

const Header = () => {
  const { isAuthenticated } = useAuthStore();
  const navItems = [
    { label: "Home", target: "hero" },
    { label: "About Us", target: "about" },
    { label: "Our Services", target: "services" },
    { label: "Stories", target: "stats" },
  ];

  const handleScroll = (target: string) => {
    const el = document.getElementById(target);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <AppBar
      position="sticky"
      sx={{
        bgcolor: "white",
        boxShadow: 3,
        height: "80px",
        justifyContent: "center",
        top: 0,
        zIndex: 1000,
      }}
    >
      <Toolbar
        sx={{
          justifyContent: "center",
          maxWidth: "1400px",
          width: "100%",
          margin: "0 auto",
          px: { xs: 2, sm: 3, md: 4 },
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            gap: { xs: 2, md: 3 },
          }}
        >
          {/* Left Side: Logo + Navigation */}
          <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 2, md: 3, lg: 4 } }}>
            {/* Logo */}
            <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              <BrandMark className="h-[60px] text-primary" />
            </Box>

            {/* Navigation Items */}
            <Stack
              direction="row"
              spacing={{ xs: 1.5, md: 2, lg: 3 }}
              sx={{
                alignItems: "center",
              }}
            >
              {navItems.map((item) => (
                <Typography
                  key={item.target}
                  component="button"
                  sx={{
                    color: "#2F302F",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    fontSize: { xs: "0.9rem", md: "1rem" },
                    fontWeight: 600,
                    "&:hover": {
                      color: "var(--primary)",
                    },
                    background: "none",
                    border: "none",
                    padding: 0,
                  }}
                  onClick={() => handleScroll(item.target)}
                >
                  {item.label}
                </Typography>
              ))}
            </Stack>
          </Box>

          {/* Right Side: Auth Buttons */}
          <Stack direction="row" spacing={2} sx={{ flexShrink: 0, alignItems: "center" }}>
            {isAuthenticated ? (
              <>
                <UserMenu />
                <Link to="/dashboard">
                  <Button
                    variant="contained"
                    colorScheme="primary"
                    className={clsx(
                      "h-12 cursor-pointer border border-black bg-black text-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1"
                    )}
                  >
                    Dashboard
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/auth/login">
                  <Button variant="outlined" colorScheme="primary">
                    Login
                  </Button>
                </Link>
                <Link to="/auth/signup">
                  <Button variant="contained" colorScheme="primary">
                    Sign Up
                  </Button>
                </Link>
              </>
            )}
          </Stack>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default Header;
