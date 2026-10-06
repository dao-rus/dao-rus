import type { ReactNode } from "react";
import { parseInlineMarkdown, parseMarkdown, type InlineNode } from "../lib/user-markdown";

// The single renderer for user-authored content text. It builds a React tree (no raw HTML,
// innerHTML) and never changes the stored source.
function renderInline(nodes: InlineNode[], preview = false): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text": return node.value;
      case "br": return <br key={index} />;
      case "strong": return <strong key={index}>{renderInline(node.children, preview)}</strong>;
      case "em": return <em key={index}>{renderInline(node.children, preview)}</em>;
      // Previews sit inside a clickable card: links keep their text but are not interactive.
      case "link": return preview ? <span key={index} className="userTextLink">{renderInline(node.children, preview)}</span> : <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
        {renderInline(node.children)}</a>;
    }
  });
}

export function UserText({ text, inline = false, preview = false, className }: {
  text: string; inline?: boolean; preview?: boolean; className?: string;
}) {
  const classes = className ? `userText ${className}` : "userText";
  if (inline) return <span className={classes}>{renderInline(parseInlineMarkdown(text), preview)}</span>;
  return <div className={classes}>{parseMarkdown(text).map((block, index) => block.type === "list"
    ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{renderInline(item, preview)}</li>)}</ul>
    : <p key={index}>{renderInline(block.children, preview)}</p>)}</div>;
}
