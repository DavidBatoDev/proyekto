import { motion } from "framer-motion";
import { Check } from "lucide-react";

interface StepIndicatorProps {
  step: number;
  currentStep: number;
  label: string;
  /** Reserved for callers that pass it. Color is uniform now. */
  totalSteps?: number;
}

export function StepIndicator({
  step,
  currentStep,
  label,
}: StepIndicatorProps) {
  const isActive = step === currentStep;
  const isCompleted = step < currentStep;
  const isOn = isActive || isCompleted;

  const bgClass = isOn ? "bg-slate-900" : "bg-slate-200";
  const textClass = isOn ? "text-white" : "text-slate-500";
  const labelClass = isActive
    ? "text-slate-900 font-semibold"
    : isCompleted
      ? "text-slate-700"
      : "text-slate-400";

  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <motion.div
          className={`relative flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold transition-colors duration-300 ${bgClass} ${textClass}`}
          initial={false}
          animate={{ scale: isActive ? 1.1 : 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
        >
          <motion.span
            initial={false}
            animate={{
              scale: isCompleted ? [1, 1.15, 1] : 1,
              opacity: isCompleted ? [0, 1] : 1,
            }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            {isCompleted ? <Check className="h-5 w-5" /> : <span>{step}</span>}
          </motion.span>
        </motion.div>
      </div>
      <p
        className={`mt-2 max-w-20 text-center text-xs leading-tight transition-colors duration-300 ${labelClass}`}
      >
        {label}
      </p>
    </div>
  );
}
