import { AppBar, Badge, Box, Button, Container, LinearProgress, Toolbar, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, type QueueRow } from "./api.js";
import { Suspense } from "react";
import { Link as RouterLink, Outlet } from "react-router";

export function Layout() {
  // Sites waiting for a payment, overdue or suspended: the operator's billing to-do.
  const queue = useQuery({ queryKey: ["billing-queue"], queryFn: () => api<{ sites: QueueRow[] }>("/billing/queue") });
  const waiting = queue.data?.sites.length ?? 0;
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/auth/me");
      return res.ok ? ((await res.json()) as { name: string | null; email: string | null }) : null;
    },
    staleTime: Infinity,
  });
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "grey.50" }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography component={RouterLink} to="/" variant="h6" sx={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}>
            스타터 홈페이지 운영
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={RouterLink} to="/">
            사이트
          </Button>
          <Button component={RouterLink} to="/customers">
            고객
          </Button>
          <Badge badgeContent={waiting} color="warning" overlap="rectangular" data-testid="nav-payments-badge">
            <Button component={RouterLink} to="/payments">
              결제
            </Button>
          </Badge>
          <Button component={RouterLink} to="/reports">
            분기 리포트
          </Button>
          <Button component={RouterLink} to="/sites/new" variant="contained">
            새 사이트
          </Button>
          {me.data ? (
            <Typography variant="body2" color="text.secondary" data-testid="signed-in" title={me.data.email ?? ""}>
              {me.data.name ?? me.data.email}
            </Typography>
          ) : null}
          <Button href="/auth/logout" size="small" color="inherit">
            로그아웃
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        <Suspense fallback={<LinearProgress />}>
          <Outlet />
        </Suspense>
      </Container>
    </Box>
  );
}
