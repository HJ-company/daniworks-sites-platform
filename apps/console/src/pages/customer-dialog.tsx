import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, type Customer, type CustomerSummary } from "../api.js";
import { ErrorAlert, useToast } from "../ui.js";

const FIELDS: { key: keyof Customer; body: string; label: string; helper?: string }[] = [
  { key: "name", body: "name", label: "업체명(필수)" },
  { key: "contact_name", body: "contactName", label: "담당자(사장님)" },
  { key: "phone", body: "phone", label: "연락처" },
  { key: "email", body: "email", label: "이메일" },
  { key: "business_number", body: "businessNumber", label: "사업자등록번호", helper: "숫자 10자리" },
  { key: "invoice_email", body: "invoiceEmail", label: "세금계산서 이메일" },
  { key: "external_ref", body: "externalRef", label: "외부 리드 링크", helper: "노션 등 리드 페이지 주소" },
  { key: "memo", body: "memo", label: "메모" },
];

const onlyDigits = (value: string | null | undefined) => (value ?? "").replace(/[^\d]/g, "");

/**
 * Add (no customer) or edit a customer. Only changed fields are sent on edit. `initial`
 * prefills a new customer (keys: name, contactName, phone…); `onCreated` replaces the default
 * jump to the new customer's page.
 */
export function CustomerDialog({
  customer,
  onClose,
  initial = {},
  onCreated,
}: {
  customer?: Customer;
  onClose: () => void;
  initial?: Record<string, string>;
  onCreated?: (customer: Customer) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const all = useQuery({ queryKey: ["customers"], queryFn: () => api<{ customers: CustomerSummary[] }>("/customers") });
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.body, (customer?.[f.key] as string | null | undefined) ?? initial[f.body] ?? ""])),
  );
  // Same phone or business number as someone else: likely the same owner registered twice.
  const duplicates = (all.data?.customers ?? []).filter(
    (c) =>
      c.id !== customer?.id &&
      ((onlyDigits(values.phone).length >= 9 && onlyDigits(c.phone) === onlyDigits(values.phone)) ||
        (onlyDigits(values.businessNumber).length === 10 && onlyDigits(c.business_number) === onlyDigits(values.businessNumber))),
  );
  const changed = Object.fromEntries(
    FIELDS.filter((f) => values[f.body] !== ((customer?.[f.key] as string | null | undefined) ?? "")).map((f) => [f.body, values[f.body]]),
  );
  const save = useMutation({
    mutationFn: () =>
      customer
        ? api<{ customer: Customer }>(`/customers/${customer.id}`, { method: "PATCH", json: changed })
        : api<{ customer: Customer }>("/customers", { method: "POST", json: changed }),
    onSuccess: (data) => {
      toast(customer ? "고객 정보를 저장했습니다" : "고객을 추가했습니다");
      void queryClient.invalidateQueries();
      onClose();
      if (!customer) {
        if (onCreated) onCreated(data.customer);
        else navigate(`/customers/${data.customer.id}`);
      }
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{customer ? "고객 정보" : "고객 추가"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {FIELDS.map((f) => (
            <TextField
              key={f.body}
              label={f.label}
              value={values[f.body]}
              helperText={f.helper}
              multiline={f.body === "memo"}
              minRows={f.body === "memo" ? 2 : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f.body]: e.target.value }))}
              slotProps={{ htmlInput: { name: f.body } }}
            />
          ))}
          {duplicates.length ? (
            <Alert severity="warning" data-testid="duplicate-customer">
              같은 연락처나 사업자번호의 고객이 있습니다: {duplicates.map((c) => c.name).join(", ")}. 같은 사장님이면 새로 만들지 말고 기존 고객에 사이트를 연결하세요.
            </Alert>
          ) : null}
          <ErrorAlert error={save.error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>닫기</Button>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending || !values.name?.trim() || !Object.keys(changed).length}>
          저장
        </Button>
      </DialogActions>
    </Dialog>
  );
}
