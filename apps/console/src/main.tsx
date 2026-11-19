import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { koKR } from "@mui/material/locale";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { Layout } from "./layout.js";
import { lazy } from "react";

const SitesPage = lazy(() => import("./pages/SitesPage.js").then((m) => ({ default: m.SitesPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage.js").then((m) => ({ default: m.ReportsPage })));
const PaymentsPage = lazy(() => import("./pages/billing/PaymentsPage.js").then((m) => ({ default: m.PaymentsPage })));
const CustomersPage = lazy(() => import("./pages/CustomersPage.js").then((m) => ({ default: m.CustomersPage })));
const CustomerPage = lazy(() => import("./pages/CustomerPage.js").then((m) => ({ default: m.CustomerPage })));
// Every page loads on first use: the first screen (sites list) carries only what it needs.
const SitePage = lazy(() => import("./pages/SitePage.js").then((m) => ({ default: m.SitePage })));
const GuidesPage = lazy(() => import("./pages/GuidesPage.js").then((m) => ({ default: m.GuidesPage })));
const AiToolsPage = lazy(() => import("./pages/AiToolsPage.js").then((m) => ({ default: m.AiToolsPage })));
import { ToastProvider } from "./ui.js";

// Korean text for MUI components (the data grid gets its own in grid-locale.ts, loaded with it).
const theme = createTheme(
  {
    palette: { primary: { main: "#157a5c" } },
    typography: { fontFamily: '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif' },
    components: { MuiButton: { defaultProps: { disableElevation: true } } },
  },
  koKR,
);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <SitesPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "payments", element: <PaymentsPage /> },
      { path: "customers", element: <CustomersPage /> },
      { path: "customers/:customerId", element: <CustomerPage /> },
      { path: "guides/:slug?", element: <GuidesPage /> },
      { path: "ai-tools", element: <AiToolsPage /> },
      { path: "sites/:siteId/:tab?", element: <SitePage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
