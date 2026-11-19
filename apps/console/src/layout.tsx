import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { AppBar, Badge, Box, Button, Chip, Container, LinearProgress, Toolbar, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, useMe, type QueueRow } from "./api.js";
import { Suspense } from "react";
import { Link as RouterLink, Outlet } from "react-router";

export function Layout() {
  // Sites waiting for a payment, overdue or suspended: the operator's billing to-do.
  const queue = useQuery({ queryKey: ["billing-queue"], queryFn: () => api<{ sites: QueueRow[] }>("/billing/queue") });
  const waiting = queue.data?.sites.length ?? 0;
  const me = useMe();
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
          <Button component={RouterLink} to="/guides">
            제작 지침
          </Button>
          <Button component={RouterLink} to="/ai-tools">
            AI로 만들기
          </Button>
          {me.data ? (
            <Chip
              icon={<AccountCircleIcon />}
              label={me.data.name ?? me.data.email}
              variant="outlined"
              title={`로그인: ${me.data.email ?? ""}`}
              data-testid="signed-in"
            />
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
