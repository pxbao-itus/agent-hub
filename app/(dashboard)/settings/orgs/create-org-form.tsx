"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  slug: z.string().min(2).max(48).regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers, and hyphens only"),
});

type FormValues = z.infer<typeof schema>;

export function CreateOrgForm() {
  const router = useRouter();
  const createOrg = trpc.org.create.useMutation({
    onSuccess: () => {
      toast({ title: "Organization created", variant: "success" });
      router.refresh();
      reset();
    },
    onError: (e) => toast({ title: "Failed to create", description: e.message, variant: "destructive" }),
  });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const name = watch("name");
  function autoSlug(value: string) {
    setValue("slug", value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""), { shouldValidate: true });
  }

  return (
    <form onSubmit={handleSubmit((data) => createOrg.mutateAsync(data))} className="max-w-sm space-y-4">
      {createOrg.error && (
        <p className="text-sm text-destructive">{createOrg.error.message}</p>
      )}
      <div className="space-y-2">
        <Label htmlFor="org-name">Name</Label>
        <Input
          id="org-name"
          placeholder="Acme Inc."
          {...register("name")}
          onChange={(e) => { register("name").onChange(e); autoSlug(e.target.value); }}
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-slug">Slug</Label>
        <Input id="org-slug" placeholder="acme-inc" {...register("slug")} />
        {errors.slug && <p className="text-xs text-destructive">{errors.slug.message}</p>}
      </div>
      <Button type="submit" disabled={isSubmitting || createOrg.isPending}>
        {createOrg.isPending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
