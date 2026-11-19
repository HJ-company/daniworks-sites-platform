import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, Button, Stack } from "@mui/material";
import { useState, type ReactNode } from "react";
import { useToast } from "./ui.js";

/** Copy to the clipboard, then say so. */
export function useCopy() {
  const toast = useToast();
  return (text: string, done: string) => void navigator.clipboard.writeText(text).then(() => toast(done));
}

/**
 * A message the operator sends an owner (draft link, payment request, DNS guide): a copy
 * button and a toggle to read it first. `before` adds buttons at the start of the row.
 */
export function CopyableMessage({
  text,
  copyLabel,
  copied,
  testid,
  before,
}: {
  text: string;
  copyLabel: string;
  copied: string;
  testid?: string;
  before?: ReactNode;
}) {
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        {before}
        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => copy(text, copied)}>
          {copyLabel}
        </Button>
        <Button size="small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "안내문 접기" : "안내문 보기"}
        </Button>
      </Stack>
      {open ? (
        <Box
          component="pre"
          data-testid={testid}
          sx={{ mt: 1, mb: 0, p: 1.5, bgcolor: "grey.100", borderRadius: 1, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14 }}
        >
          {text}
        </Box>
      ) : null}
    </Box>
  );
}
