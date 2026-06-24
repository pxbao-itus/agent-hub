"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { UserPlus } from "lucide-react";

export function CreateUserDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [systemRole, setSystemRole] = useState<"user" | "superadmin">("user");

  const create = trpc.user.create.useMutation({
    onSuccess: () => {
      toast({ title: "User created", variant: "success" });
      setOpen(false);
      reset();
      router.refresh();
    },
    onError: (e) => toast({ title: "Failed to create user", description: e.message, variant: "destructive" }),
  });

  function reset() {
    setName(""); setEmail(""); setPassword(""); setSystemRole("user");
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1.5 h-4 w-4" />
        New user
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="cu-name">Name <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <Input
                id="cu-name"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={create.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cu-email">Email</Label>
              <Input
                id="cu-email"
                type="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={create.isPending}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cu-password">
                Password <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="cu-password"
                type="password"
                placeholder="Min 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={create.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty if the user will sign in via OAuth (Google / GitHub).
              </p>
            </div>

            <div className="space-y-2">
              <Label>System role</Label>
              <Select
                value={systemRole}
                onValueChange={(v) => setSystemRole(v as "user" | "superadmin")}
                disabled={create.isPending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User — standard access</SelectItem>
                  <SelectItem value="superadmin">Superadmin — full platform access</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {create.error && <p className="text-sm text-destructive">{create.error.message}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button
              disabled={!email || create.isPending}
              onClick={() =>
                create.mutate({
                  name: name || undefined,
                  email,
                  password: password || undefined,
                  systemRole,
                })
              }
            >
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
