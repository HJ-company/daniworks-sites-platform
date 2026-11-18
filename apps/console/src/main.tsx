import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import { Layout } from "./layout.js";
import { lazy } from "react";
import { NewSitePage } from "./pages/NewSitePage.js";
import { SitePage } from "./pages/SitePage.js";

const SitesPage = lazy(() => import("./pages/SitesPage.js").then((m) => ({ default: m.SitesPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage.js").then((m) => ({ default: m.ReportsPage })));
import { ToastProvider } from "./ui.js";

const theme = createTheme({
  palette: { primary: { main: "#157a5c" } },
  typography: { fontFamily: '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif' },
  components: { MuiButton: { defaultProps: { disableElevation: true } } },
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <SitesPage /> },
      { path: "sites/new", element: <NewSitePage /> },
      { path: "reports", element: <ReportsPage /> },
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
