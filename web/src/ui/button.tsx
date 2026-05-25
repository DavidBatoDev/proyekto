import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "contained" | "outlined" | "text";
  colorScheme?: "primary" | "secondary" | "destructive" | "accent" | "muted";
  size?: "sm" | "md" | "lg";
}

const buttonVariants = {
  base: "inline-flex items-center justify-center whitespace-nowrap rounded-lg font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  variants: {
    contained: {
      primary:
        "bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-0.5 shadow-sm",
      secondary:
        "bg-secondary text-secondary-foreground hover:bg-secondary/90 hover:-translate-y-0.5 shadow-sm",
      destructive:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:-translate-y-0.5 shadow-sm",
      accent:
        "bg-accent text-accent-foreground hover:bg-accent/90 hover:-translate-y-0.5 shadow-sm",
      muted:
        "bg-muted text-muted-foreground hover:bg-muted/90 hover:-translate-y-0.5 shadow-sm",
    },
    outlined: {
      primary:
        "border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground hover:-translate-y-0.5",
      secondary:
        "border-2 border-secondary text-secondary hover:bg-secondary hover:text-secondary-foreground hover:-translate-y-0.5",
      destructive:
        "border-2 border-destructive text-destructive hover:bg-destructive hover:text-white hover:-translate-y-0.5",
      accent:
        "border-2 border-accent text-accent-foreground hover:bg-accent hover:-translate-y-0.5",
      muted:
        "border-2 border-muted text-muted-foreground hover:bg-muted hover:-translate-y-0.5",
    },
    text: {
      primary: "text-primary hover:bg-primary/10 hover:-translate-y-0.5",
      secondary: "text-secondary hover:bg-secondary/10 hover:-translate-y-0.5",
      destructive:
        "text-destructive hover:bg-destructive/10 hover:-translate-y-0.5",
      accent:
        "text-accent-foreground hover:bg-accent/10 hover:-translate-y-0.5",
      muted: "text-muted-foreground hover:bg-muted/10 hover:-translate-y-0.5",
    },
  },
  sizes: {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "contained",
      colorScheme = "primary",
      size = "md",
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          buttonVariants.base,
          buttonVariants.variants[variant][colorScheme],
          buttonVariants.sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
