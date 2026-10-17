import { useEffect, useRef } from "react";

/**
 * Calls `onChange` with the document being edited each time an edit, undo or
 * redo changes it (not on the first render). The latest `onChange` is used,
 * so a host need not memoize it.
 */
export function useReportChange<T>(current: T, onChange: ((doc: T) => void) | undefined): void {
  const latest = useRef(onChange);
  latest.current = onChange;
  const previous = useRef(current);
  useEffect(() => {
    if (previous.current === current) return;
    previous.current = current;
    latest.current?.(current);
  }, [current]);
}
