import type { ReactNode } from "react";

// One outline set for the Exchange type strip. Inline SVG does not depend on the
// glyph coverage of the visitor's system fonts; unknown catalogue types get a dot.
const paths: Record<string, ReactNode> = {
  need: <><path d="M7.8 8.6a4.2 4.2 0 1 1 6.6 3.5c-1.3.9-2.4 1.7-2.4 3.4" /><path d="M12 19.6v.01" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></>,
  can: <><path d="M12 4v10.5" /><path d="M12 19.6v.01" /></>,
  have: <path d="M12 5v14M5 12h14" />,
  know: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.01" /></>,
  skill: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  want: <path d="M12 20s-7.5-4.6-7.5-10.2a4.1 4.1 0 0 1 7.5-2.3 4.1 4.1 0 0 1 7.5 2.3C19.5 15.4 12 20 12 20z" />,
  doing: <path d="M8 5.5v13l10.5-6.5z" />,
  idea: <path d="M12 3.5l2.2 6.3 6.3 2.2-6.3 2.2-2.2 6.3-2.2-6.3L3.5 12l6.3-2.2z" />,
  dating: <><circle cx="9" cy="12" r="5.2" /><circle cx="15" cy="12" r="5.2" /></>,
};

export function SignalTypeIcon({ typeKey }: { typeKey: string }) {
  return <svg className="signalTypeIcon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[typeKey] ?? <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />}
  </svg>;
}
