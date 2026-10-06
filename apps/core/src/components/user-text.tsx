import type { ReactNode } from "react";
import { parseInlineMarkdown, parseMarkdown, type InlineNode } from "../lib/user-markdown";

// The single renderer for user-authored content text. It builds a React tree (no raw HTML,
// innerHTML) and never changes the stored source.
function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text": return node.value;
      case "br": return <br key={index} />;
      case "strong": return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em": return <em key={index}>{renderInline(node.children)}</em>;
      case "link": return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
        {renderInline(node.children)}</a>;
    }
  });
}

export function UserText({ text, inline = false, className }: { text: string; inline?: boolean; className?: string }) {
  const classes = className ? `userText ${className}` : "userText";
  if (inline) return <span className={classes}>{renderInline(parseInlineMarkdown(text))}</span>;
  return <div className={classes}>{parseMarkdown(text).map((block, index) => block.type === "list"
    ? <ul key={index}>{block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}</ul>
    : <p key={index}>{renderInline(block.children)}</p>)}</div>;
}
