import Link from "next/link";
import type { ReactNode } from "react";
import { UserText } from "./user-text";

// One compact, wholly clickable Signal preview used by every Signal list. A single anchor holds
// the content (label, description, author text) and is stretched over the card; the full text
// and Markdown links live on the Signal card itself, so the preview has no nested links.
export function SignalPreview({ as: Tag = "article", href, label, description, author, kicker, meta, badge, children }: {
  as?: "article" | "li"; href: string; label: string; description?: string | null;
  author?: string | null; kicker?: string; meta?: string; badge?: string; children?: ReactNode;
}) {
  return <Tag className="signalPreviewCard">
    <Link className="signalPreview" href={href}>
      {kicker ? <span className="signalPreviewKicker">{kicker}</span> : null}
      <span className="signalPreviewLabel"><UserText inline preview text={label} /></span>
      {description ? <UserText preview className="signalPreviewDescription" text={description} /> : null}
      {badge ? <span className="signalPreviewFooter">
        <span className="signalPreviewAuthor">{[author, meta].filter(Boolean).join(" · ")}</span>
        <span className="signalPreviewBadge">{badge}</span>
      </span> : <>
        {author ? <span className="signalPreviewAuthor">{author}</span> : null}
        {meta ? <span className="signalPreviewAuthor">{meta}</span> : null}
      </>}
    </Link>
    {children ? <div className="signalPreviewActions">{children}</div> : null}
  </Tag>;
}
