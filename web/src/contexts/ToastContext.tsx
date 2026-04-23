import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

type Severity = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  severity: Severity;
  duration: number;
}

interface ToastOptions {
  message: string;
  severity?: Severity;
  duration?: number;
}

interface ToastContextValue {
  showToast: (options: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const STYLE: Record<
  Severity,
  { bar: string; icon: ReactNode; text: string; close: string }
> = {
  success: {
    bar: "border-l-emerald-500",
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />,
    text: "text-slate-800",
    close: "text-slate-400 hover:text-slate-600",
  },
  error: {
    bar: "border-l-red-500",
    icon: <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />,
    text: "text-slate-800",
    close: "text-slate-400 hover:text-slate-600",
  },
  warning: {
    bar: "border-l-amber-500",
    icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />,
    text: "text-slate-800",
    close: "text-slate-400 hover:text-slate-600",
  },
  info: {
    bar: "border-l-blue-500",
    icon: <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />,
    text: "text-slate-800",
    close: "text-slate-400 hover:text-slate-600",
  },
};

let nextId = 0;

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const style = STYLE[toast.severity];

  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true));
    const hide = setTimeout(() => setVisible(false), toast.duration - 300);
    const remove = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(hide);
      clearTimeout(remove);
    };
  }, [toast.id, toast.duration, onDismiss]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  return (
    <div
      className={`
        flex items-start gap-3 w-80 bg-white rounded-xl shadow-lg border border-slate-200
        border-l-4 ${style.bar} px-4 py-3
        transition-all duration-300 ease-out
        ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}
      `}
    >
      {style.icon}
      <p className={`flex-1 text-sm font-medium leading-snug ${style.text}`}>
        {toast.message}
      </p>
      <button
        onClick={handleClose}
        className={`shrink-0 mt-0.5 transition-colors ${style.close}`}
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, severity = "info", duration = 5000 }: ToastOptions) => {
      setToasts((prev) => [
        ...prev,
        { id: ++nextId, message, severity, duration },
      ]);
    },
    [],
  );

  const success = useCallback(
    (message: string, duration = 5000) =>
      showToast({ message, severity: "success", duration }),
    [showToast],
  );
  const error = useCallback(
    (message: string, duration = 5000) =>
      showToast({ message, severity: "error", duration }),
    [showToast],
  );
  const warning = useCallback(
    (message: string, duration = 5000) =>
      showToast({ message, severity: "warning", duration }),
    [showToast],
  );
  const info = useCallback(
    (message: string, duration = 5000) =>
      showToast({ message, severity: "info", duration }),
    [showToast],
  );

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      <div className="fixed top-4 right-4 z-9999 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
