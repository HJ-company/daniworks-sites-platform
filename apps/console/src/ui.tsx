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

/** Site or domain status. A site never published shows as 미공개 rather than 운영. */
export function StatusChip({ status, cancelled, unpublished }: { status: string; cancelled?: string | null; unpublished?: boolean }) {
  if (cancelled) return <Chip size="small" label="해지" color="default" />;
  if (unpublished && status === "active") return <Chip size="small" label="미공개" color="default" variant="outlined" />;
  const map: Record<string, { label: string; color: "success" | "warning" | "default" | "error" | "info" }> = {
    active: { label: "운영", color: "success" },
    suspended: { label: "공개 중단", color: "warning" },
    pending: { label: "검증 대기", color: "info" },
    failed: { label: "실패", color: "error" },
    removing: { label: "삭제 중", color: "default" },
  };
  const entry = map[status] ?? { label: status, color: "default" as const };
  return <Chip size="small" label={entry.label} color={entry.color} />;
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  // The text outlives `open` so the closing animation never shows an empty box.
  const [toast, setToast] = useState<{ open: boolean; text: string; key: number }>({ open: false, text: "", key: 0 });
  const show = useCallback((text: string) => setToast((prev) => ({ open: true, text, key: prev.key + 1 })), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <Snackbar
        key={toast.key}
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast((prev) => ({ ...prev, open: false }))}
        message={toast.text}
      />
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
