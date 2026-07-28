import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type ResolvedMention = {
  id: string;
  username: string;
  name: string | null;
};

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: MarkdownNode[];
};

function mentionPlugin(mentions: ResolvedMention[]) {
  const mentionByUsername = new Map(mentions.map((mention) => [mention.username, mention]));

  return function resolvedMentionPlugin() {
    return function transform(tree: MarkdownNode) {
      function visit(node: MarkdownNode) {
        if (!node.children || node.type === "link" || node.type === "linkReference") return;

        const nextChildren: MarkdownNode[] = [];
        for (const child of node.children) {
          if (child.type !== "text" || !child.value) {
            visit(child);
            nextChildren.push(child);
            continue;
          }

          const pattern = /(^|[^a-zA-Z0-9_@])@([a-z][a-z0-9]{2,31})\b/g;
          let cursor = 0;
          let changed = false;
          for (const match of child.value.matchAll(pattern)) {
            const index = match.index ?? 0;
            const boundary = match[1] ?? "";
            const username = match[2] ?? "";
            const mention = mentionByUsername.get(username);
            if (!mention) continue;

            changed = true;
            const mentionStart = index + boundary.length;
            if (mentionStart > cursor) {
              nextChildren.push({ type: "text", value: child.value.slice(cursor, mentionStart) });
            }
            nextChildren.push({
              type: "link",
              url: `#mention-${encodeURIComponent(username)}`,
              title: `@${username}`,
              children: [{ type: "text", value: `@${mention.name ?? username}` }],
            });
            cursor = mentionStart + username.length + 1;
          }
          if (changed) {
            if (cursor < child.value.length) {
              nextChildren.push({ type: "text", value: child.value.slice(cursor) });
            }
          } else {
            nextChildren.push(child);
          }
        }
        node.children = nextChildren;
      }

      visit(tree);
    };
  };
}

/**
 * Render user-authored markdown. Raw HTML is NOT rendered (react-markdown
 * escapes it by default — no rehype-raw), so this is safe for untrusted bodies.
 * Styling lives in the `.markdown-body` scope in globals.css.
 */
export function MarkdownView({
  children,
  className,
  mentions = [],
}: {
  children: string;
  className?: string;
  mentions?: ResolvedMention[];
}) {
  return (
    <div className={cn("markdown-body", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, mentionPlugin(mentions)]}
        components={{
          a: ({ href, children: linkChildren, ...props }: ComponentPropsWithoutRef<"a">) => {
            if (href?.startsWith("#mention-")) {
              return (
                <span
                  className="rounded bg-primary/10 px-1 font-medium text-primary"
                  title={props.title ?? undefined}
                >
                  {linkChildren}
                </span>
              );
            }
            const external = !!href && /^https?:\/\//.test(href);
            return (
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                {...props}
              >
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
