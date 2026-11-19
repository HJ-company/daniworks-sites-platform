import { Button, LinearProgress, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useParams } from "react-router";
import { api, CYCLE_LABEL, won, type CustomerDetail, type Payment } from "../api.js";
import { ErrorAlert, StatusChip } from "../ui.js";
import { BillingChip, billingSummary } from "./billing/billing-ui.js";
import { EditPaymentDialog } from "./billing/PaymentsPage.js";
import { CustomerDialog } from "./CustomersPage.js";

export function CustomerPage() {
  const { customerId = "" } = useParams();
  const [editing, setEditing] = useState(false);
  const [invoicing, setInvoicing] = useState<Payment | null>(null);
  const detail = useQuery({ queryKey: ["customer", customerId], queryFn: () => api<CustomerDetail>(`/customers/${customerId}`) });
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (!detail.data) return <LinearProgress />;
  const { customer, sites, payments } = detail.data;
  const info: [string, string | null][] = [
    ["담당자", customer.contact_name],
    ["연락처", customer.phone],
    ["이메일", customer.email],
    ["사업자등록번호", customer.business_number],
    ["세금계산서 이메일", customer.invoice_email],
    ["메모", customer.memo],
  ];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }} data-testid="customer-title">
          {customer.name}
        </Typography>
        {customer.external_ref ? (
          <Button href={customer.external_ref} target="_blank" rel="noopener">
            리드 보기
          </Button>
        ) : null}
        <Button variant="outlined" onClick={() => setEditing(true)}>
          정보 수정
        </Button>
      </Stack>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={3} useFlexGap sx={{ flexWrap: "wrap" }}>
          {info.map(([label, value]) => (
            <Stack key={label}>
              <Typography variant="caption" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="body2">{value ?? "-"}</Typography>
            </Stack>
          ))}
        </Stack>
      </Paper>
      <Paper>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
          사이트 {sites.length}곳
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>상호</TableCell>
              <TableCell>공개</TableCell>
              <TableCell>구독</TableCell>
              <TableCell>청구</TableCell>
              <TableCell>상황</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sites.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link component={RouterLink} to={`/sites/${s.id}`}>
                    {s.business_name ?? s.slug}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusChip status={s.status} cancelled={s.cancelled_at} unpublished={!s.published_version_id} />
                  {s.status === "suspended" && !s.cancelled_at ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                      {s.suspend_reason === "billing" ? "미납" : "운영자 정지"}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  <BillingChip status={s.subscription.status} />
                </TableCell>
                <TableCell>
                  {CYCLE_LABEL[s.subscription.cycle]} {won(s.subscription.amount)}
                </TableCell>
                <TableCell>{billingSummary(s.subscription)}</TableCell>
              </TableRow>
            ))}
            {!sites.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    연결된 사이트가 없습니다. 사이트 개요의 '고객'에서 연결하세요.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
      <Paper>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, p: 2, pb: 0 }}>
          결제 이력
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>입금일</TableCell>
              <TableCell>사이트</TableCell>
              <TableCell>금액</TableCell>
              <TableCell>이용 기간</TableCell>
              <TableCell>계산서</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.map((p) => (
              <TableRow key={p.id} sx={p.voided_at ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                <TableCell>{p.paid_on}</TableCell>
                <TableCell>{p.business_name ?? p.site_slug}</TableCell>
                <TableCell>{won(p.amount)}</TableCell>
                <TableCell>
                  {p.period_start} ~ {p.period_end}
                </TableCell>
                <TableCell>
                  {p.voided_at ? (
                    "-"
                  ) : (
                    <Button size="small" onClick={() => setInvoicing(p)} data-testid={`invoice-${p.id}`}>
                      {p.invoice_issued_on ?? "미발행 · 기록"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!payments.length ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    결제 이력이 없습니다.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Paper>
      {editing ? <CustomerDialog customer={customer} onClose={() => setEditing(false)} /> : null}
      {invoicing ? <EditPaymentDialog payment={invoicing} onClose={() => setInvoicing(null)} focusInvoice /> : null}
    </Stack>
  );
}
