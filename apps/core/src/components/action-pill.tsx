import Link from "next/link";
import type { ReactNode } from "react";

type ActionPillProps = {
  href: string;
  children: ReactNode;
};

/** Presentation only: the caller supplies the task copy and destination. */
export function ActionPill({ href, children }: ActionPillProps) {
  return <Link className="actionPill" href={href}>{children}</Link>;
}
