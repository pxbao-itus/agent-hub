"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { KeyRound } from "lucide-react";

type TargetUser = {
  id: string;
  name: string | null;
  email: string;
  hasPassword: boolean;
};

type Props = {
  user: TargetUser | null;
  onClose: () => void;
};

export function EditUserDialog({ user, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setEmail(user.email);
      setPassword("");
      setRemovePassword(false);
    }
  }, [user]);

  const update = trpc.user.update.useMutation({
    onSuccess: () => {
      toast({ title: "User updated", variant: "success" });
      onClose();
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to update user", description: e.message, variant: "destructive" }),
  });

  if (!user) return null;

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="eu-name">Name</Label>
            <Input
              id="eu-name"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={update.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eu-email">Email</Label>
            <Input
              id="eu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={update.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eu-password">
              {user.hasPassword ? "Change password" : "Set password"}
              <span className="ml-1 text-muted-foreground text-xs font-normal">(leave empty to keep unchanged)</span>
            </Label>
            <Input
              id="eu-password"
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (e.target.value) setRemovePassword(false); }}
              disabled={update.isPending || removePassword}
            />
          </div>

          {user.hasPassword && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-warning" />
              <div className="flex-1 text-sm">
                <span className="text-muted-foreground">Remove password</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  User will only be able to sign in via OAuth.
                </p>
              </div>
              <Button
                type="button"
                variant={removePassword ? "default" : "outline"}
                size="sm"
                className="shrink-0"
                onClick={() => { setRemovePassword(!removePassword); setPassword(""); }}
                disabled={update.isPending}
              >
                {removePassword ? "Undo" : "Remove"}
              </Button>
            </div>
          )}

          {update.error && <p className="text-sm text-destructive">{update.error.message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!email || update.isPending}
            onClick={() =>
              update.mutate({
                userId: user.id,
                name: name || undefined,
                email: email !== user.email ? email : undefined,
                password: password || undefined,
                removePassword: removePassword || undefined,
              })
            }
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
