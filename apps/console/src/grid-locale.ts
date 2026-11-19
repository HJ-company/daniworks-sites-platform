import { koKR } from "@mui/x-data-grid/locales";

/**
 * Korean data grid text. Imported only by lazily loaded pages, so it ships with the grid. The
 * stock Korean pagination still says "1–25 of 62"; ours matches the plain tables.
 */
export const gridLocale = {
  ...koKR.components.MuiDataGrid.defaultProps.localeText,
  paginationDisplayedRows: ({ from, to, count }: { from: number; to: number; count: number }) => `${from}–${to} / 전체 ${count}`,
  paginationRowsPerPage: "페이지당",
};
