"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/format";

const noop = () => () => {};

/** Formats a date in the viewer's time zone (blank during server render). */
export default function LocalDate({ iso, dateOnly }: { iso: string; dateOnly?: boolean }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return (
    <>
      {dateOnly
        ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
        : formatDateTime(iso)}
    </>
  );
}
