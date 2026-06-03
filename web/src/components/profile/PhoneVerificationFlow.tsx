import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { profileService } from "@/services/profile.service";
import { Loader2 } from "lucide-react";

interface PhoneVerificationFlowProps {
  onVerified: () => void;
}

const OTP_TTL_SECONDS = 10 * 60;

export function PhoneVerificationFlow({ onVerified }: PhoneVerificationFlowProps) {
  const [step, setStep] = useState<"idle" | "code-input">("idle");
  const [code, setCode] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(OTP_TTL_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => profileService.requestPhoneVerification(),
    onSuccess: () => {
      setCode("");
      setError(null);
      setSecondsLeft(OTP_TTL_SECONDS);
      setStep("code-input");
      startTimer();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Failed to send code. Please try again.";
      setError(msg);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (otp: string) => profileService.confirmPhoneVerification(otp),
    onSuccess: () => {
      clearTimer();
      onVerified();
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Invalid or expired code. Please try again.";
      setError(msg);
    },
  });

  function startTimer() {
    clearTimer();
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearTimer();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }

  function clearTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  useEffect(() => () => clearTimer(), []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (step === "idle") {
    return (
      <button
        onClick={() => requestMutation.mutate()}
        disabled={requestMutation.isPending}
        className="text-[10px] font-medium text-orange-500 hover:text-orange-600 underline underline-offset-2 disabled:opacity-50"
      >
        {requestMutation.isPending ? (
          <Loader2 className="w-3 h-3 animate-spin inline" />
        ) : (
          "Verify"
        )}
      </button>
    );
  }

  const isExpired = secondsLeft === 0;

  return (
    <div className="w-full mt-2 space-y-2">
      {error && (
        <p className="text-[10px] text-red-500">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="6-digit code"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          className="w-28 text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
          disabled={isExpired || confirmMutation.isPending}
        />
        <button
          onClick={() => {
            if (code.length === 6) confirmMutation.mutate(code);
          }}
          disabled={code.length !== 6 || isExpired || confirmMutation.isPending}
          className="text-xs font-medium bg-orange-500 text-white px-2.5 py-1 rounded hover:bg-orange-600 disabled:opacity-40"
        >
          {confirmMutation.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            "Confirm"
          )}
        </button>
        <button
          onClick={() => {
            setStep("idle");
            setCode("");
            setError(null);
            clearTimer();
          }}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
      <div className="flex items-center gap-2">
        {isExpired ? (
          <button
            onClick={() => requestMutation.mutate()}
            disabled={requestMutation.isPending}
            className="text-[10px] text-orange-500 hover:text-orange-600 underline underline-offset-2"
          >
            {requestMutation.isPending ? "Sending…" : "Resend code"}
          </button>
        ) : (
          <span className="text-[10px] text-gray-400">
            Code expires in {formatTime(secondsLeft)} ·{" "}
            <button
              onClick={() => requestMutation.mutate()}
              disabled={requestMutation.isPending}
              className="underline underline-offset-2 hover:text-gray-600"
            >
              Resend
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
