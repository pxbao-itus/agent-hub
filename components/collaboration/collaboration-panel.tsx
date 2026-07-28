"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquareText } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CommentItem } from "./comment-item";
import { MentionPicker } from "./mention-picker";
import {
  findActiveMention,
  replaceActiveMention,
  type ActiveMention,
} from "./mention-autocomplete";
import { toast } from "@/hooks/use-toast";

export function CollaborationPanel({ artifactId }: { artifactId: string }) {
  const utils = trpc.useUtils();
  const [body, setBody] = useState("");
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const markActivityRead = trpc.notification.markArtifactActivityRead.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.notification.unreadCount.invalidate(),
        utils.notification.list.invalidate(),
        utils.assignment.listMyWork.invalidate(),
      ]);
    },
  });
  const comments = trpc.comment.list.useInfiniteQuery(
    { artifactId, limit: 20 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const create = trpc.comment.create.useMutation({
    onSuccess: async (result) => {
      setBody("");
      setActiveMention(null);
      await Promise.all([
        utils.comment.list.invalidate({ artifactId }),
        utils.comment.activity.invalidate({ artifactId }),
      ]);
      if (result.unresolvedMentions.length) {
        toast({
          title: "Comment added",
          description: `Could not mention: ${result.unresolvedMentions.map((name) => `@${name}`).join(", ")}`,
        });
      }
      requestAnimationFrame(() => {
        document.getElementById(`comment-${result.comment.id}`)?.scrollIntoView({ block: "center" });
      });
    },
    onError: (error) => toast({ title: "Could not add comment", description: error.message, variant: "destructive" }),
  });

  const items = useMemo(
    () => [...(comments.data?.pages ?? [])].reverse().flatMap((page) => page.items),
    [comments.data?.pages],
  );

  useEffect(() => {
    markActivityRead.mutate({ artifactId });
    // Mark once when the collaboration surface is actually mounted.
  }, [artifactId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!items.length || !window.location.hash.startsWith("#comment-")) return;
    requestAnimationFrame(() => document.querySelector(window.location.hash)?.scrollIntoView({ block: "center" }));
  }, [items.length]);

  function submit() {
    if (!body.trim() || create.isPending) return;
    create.mutate({ artifactId, body });
  }

  function insertMention(username: string) {
    const element = composerRef.current;
    if (activeMention) {
      const replacement = replaceActiveMention(body, activeMention, username);
      setBody(replacement.value);
      setActiveMention(null);
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(replacement.caret, replacement.caret);
      });
      return;
    }
    const start = element?.selectionStart ?? body.length;
    const end = element?.selectionEnd ?? start;
    const prefix = start > 0 && !/\s/.test(body[start - 1] ?? "") ? " " : "";
    const suffix = end < body.length && !/\s/.test(body[end] ?? "") ? " " : " ";
    const token = `${prefix}@${username}${suffix}`;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + token.length;
      element?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <section id="collaboration" className="scroll-mt-20 space-y-4" aria-labelledby="collaboration-heading">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-muted-foreground" />
        <h2 id="collaboration-heading" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Discussion
        </h2>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <Textarea
          ref={composerRef}
          value={body}
          onChange={(event) => {
            const value = event.target.value;
            setBody(value);
            setActiveMention(findActiveMention(value, event.target.selectionStart));
          }}
          placeholder="Add a comment or handoff note…"
          rows={5}
          maxLength={20_000}
          disabled={create.isPending}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <MentionPicker
              artifactId={artifactId}
              onMention={insertMention}
              disabled={create.isPending}
              activeQuery={activeMention?.query ?? null}
            />
            <p className="text-xs text-muted-foreground">
              Markdown · {typeof navigator !== "undefined" && navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter
            </p>
          </div>
          <div className="flex items-center gap-3">
            {body.length > 18_000 && (
              <span className="text-xs text-muted-foreground">{body.length.toLocaleString()}/20,000</span>
            )}
            <Button type="button" size="sm" onClick={submit} disabled={!body.trim() || create.isPending}>
              {create.isPending ? "Adding…" : "Add comment"}
            </Button>
          </div>
        </div>
      </div>

      {comments.hasNextPage && (
        <div className="text-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => comments.fetchNextPage()}
            disabled={comments.isFetchingNextPage}
          >
            {comments.isFetchingNextPage ? "Loading…" : "Load earlier comments"}
          </Button>
        </div>
      )}

      {comments.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading discussion…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center">
          <p className="text-sm font-medium">No comments yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add context, progress, or a handoff note for collaborators.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((comment) => <CommentItem key={comment.id} comment={comment} />)}
        </div>
      )}
    </section>
  );
}
