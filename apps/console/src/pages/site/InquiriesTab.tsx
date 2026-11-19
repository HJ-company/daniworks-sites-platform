import { Box, Button, Stack } from "@mui/material";
import { gridLocale } from "../../grid-locale.js";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api, kst, type Inquiry } from "../../api.js";
import { ErrorAlert } from "../../ui.js";

const columns: GridColDef<Inquiry>[] = [
  { field: "created_at", headerName: "접수(KST)", width: 150, valueGetter: (value: string) => kst(value) },
  { field: "name", headerName: "이름", width: 120 },
  { field: "phone", headerName: "연락처", width: 140 },
  { field: "message", headerName: "내용", flex: 1, minWidth: 240 },
  { field: "notify_status", headerName: "알림", width: 90 },
];

export function InquiriesTab({ siteId }: { siteId: string }) {
  const pages = useInfiniteQuery({
    queryKey: ["inquiries", siteId],
    queryFn: ({ pageParam }) =>
      api<{ inquiries: Inquiry[]; next: string | null }>(
        `/sites/${siteId}/inquiries?limit=100${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  });
  const rows = pages.data?.pages.flatMap((page) => page.inquiries) ?? [];
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1}>
        <Button variant="contained" href={`/api/sites/${siteId}/inquiries.csv`} data-testid="csv">
          CSV 내려받기
        </Button>
        {pages.hasNextPage ? <Button onClick={() => void pages.fetchNextPage()}>더 보기</Button> : null}
      </Stack>
      <ErrorAlert error={pages.error} />
      <Box sx={{ bgcolor: "background.paper" }}>
        <DataGrid
          localeText={gridLocale}
          rows={rows}
          columns={columns}
          loading={pages.isLoading}
          autoHeight
          disableRowSelectionOnClick
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
          pageSizeOptions={[25, 50, 100]}
        />
      </Box>
    </Stack>
  );
}
