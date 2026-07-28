"use client";

import { useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/relative-time";
import { MarkdownView } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { MentionPicker } from "./mention-picker";
import {
  findActiveMention,
  replaceActiveMention,
  type ActiveMention,
} from "./mention-autocomplete";

type CommentRow = inferRouterOutputs<AppRouter>["comment"]["list"]["items"][number];

export function CommentItem({ comment }: { comment: CommentRow }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body ?? "");
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = trpc.comment.update.useMutation({
    onSuccess: async (result) => {
      setEditing(false);
      setActiveMention(null);
      await Promise.all([
        utils.comment.list.invalidate(),
        utils.comment.activity.invalidate({ artifactId: comment.artifactId }),
      ]);
      if (result.unresolvedMentions.length) {
        toast({
          title: "Comment updated",
          description: `Could not mention: ${result.unresolvedMentions.map((name) => `@${name}`).join(", ")}`,
        });
      }
    },
    onError: (error) => toast({ title: "Could not update comment", description: error.message, variant: "destructive" }),
  });
  const remove = trpc.comment.delete.useMutation({
    onSuccess: async () => {
      setConfirmDelete(false);
      await Promise.all([
        utils.comment.list.invalidate(),
        utils.comment.activity.invalidate({ artifactId: comment.artifactId }),
      ]);
    },
    onError: (error) => toast({ title: "Could not delete comment", description: error.message, variant: "destructive" }),
  });

  const authorLabel = comment.author?.name ?? comment.author?.username ?? "Deleted user";
  const initial = authorLabel[0]?.toUpperCase() ?? "?";
  const edited = !comment.deletedAt && comment.updatedAt.getTime() !== comment.createdAt.getTime();

  function insertMention(username: string) {
    const element = editorRef.current;
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
    const token = `${prefix}@${username} `;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    requestAnimationFrame(() => {
      element?.focus();
      const cursor = start + token.length;
      element?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <article id={`comment-${comment.id}`} className="scroll-mt-20 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium">{authorLabel}</span>
            {comment.author?.username && (
              <span className="text-xs text-muted-foreground">@{comment.author.username}</span>
            )}
            {comment.source === "mcp" && <Badge variant="outline" className="text-[10px]">via MCP</Badge>}
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.createdAt)}
              {edited ? " · edited" : ""}
            </span>
          </div>

          {comment.deletedAt ? (
            <p className="mt-3 text-sm italic text-muted-foreground">Comment deleted.</p>
          ) : editing ? (
            <div className="mt-3 space-y-2">
              <Textarea
                ref={editorRef}
                value={body}
                onChange={(event) => {
                  const value = event.target.value;
                  setBody(value);
                  setActiveMention(findActiveMention(value, event.target.selectionStart));
                }}
                maxLength={20_000}
                rows={5}
                autoFocus
                disabled={update.isPending}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    update.mutate({ commentId: comment.id, body });
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MentionPicker
                    artifactId={comment.artifactId}
                    onMention={insertMention}
                    disabled={update.isPending}
                    activeQuery={activeMention?.query ?? null}
                  />
                  <span className="text-xs text-muted-foreground">{body.length.toLocaleString()}/20,000</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBody(comment.body ?? "");
                      setActiveMention(null);
                      setEditing(false);
                    }}
                    disabled={update.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => update.mutate({ commentId: comment.id, body })}
                    disabled={!body.trim() || update.isPending}
                  >
                    {update.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <MarkdownView
              className="mt-3 text-sm"
              mentions={comment.mentions.flatMap(({ user }) =>
                user.username
                  ? [{ id: user.id, username: user.username, name: user.name }]
                  : [],
              )}
            >
              {comment.body ?? ""}
            </MarkdownView>
          )}

          {!comment.deletedAt && !editing && (comment.canEdit || comment.canDelete) && (
            <div className="mt-3 flex gap-2">
              {comment.canEdit && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {comment.canDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              The content will be removed and a deleted-comment marker will remain in the discussion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate({ commentId: comment.id })}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
