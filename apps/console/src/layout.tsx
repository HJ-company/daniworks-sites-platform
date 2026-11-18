import { AppBar, Box, Button, Container, LinearProgress, Toolbar, Typography } from "@mui/material";
import { Suspense } from "react";
import { Link as RouterLink, Outlet } from "react-router";

export function Layout() {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "grey.50" }}>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 2 }}>
          <Typography component={RouterLink} to="/" variant="h6" sx={{ color: "inherit", textDecoration: "none", fontWeight: 700 }}>
            스타터 홈페이지 운영
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Button component={RouterLink} to="/reports">
            분기 리포트
          </Button>
          <Button component={RouterLink} to="/sites/new" variant="contained">
            새 사이트
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
