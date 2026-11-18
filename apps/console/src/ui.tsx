import { Alert, Chip, Snackbar } from "@mui/material";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ApiError } from "./api.js";

/** Validation details from the api, one per line, under the message. */
export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as string[]) : [];
  return (
    <Alert severity="error" sx={{ whiteSpace: "pre-line" }} data-testid="error-alert">
      {error instanceof Error ? error.message : String(error)}
      {details.length ? `\n${details.join("\n")}` : ""}
    </Alert>
  );
}

export function StatusChip({ status, cancelled }: { status: string; cancelled?: string | null }) {
  if (cancelled) return <Chip size="small" label="해지" color="default" />;
  const map: Record<string, { label: string; color: "success" | "warning" | "default" | "error" | "info" }> = {
    active: { label: "운영", color: "success" },
    suspended: { label: "정지", color: "warning" },
    pending: { label: "검증 대기", color: "info" },
    failed: { label: "실패", color: "error" },
    removing: { label: "삭제 중", color: "default" },
  };
  const entry = map[status] ?? { label: status, color: "default" as const };
  return <Chip size="small" label={entry.label} color={entry.color} />;
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((text: string) => setMessage(text), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar open={Boolean(message)} autoHideDuration={3000} onClose={() => setMessage(null)} message={message ?? ""} />
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
