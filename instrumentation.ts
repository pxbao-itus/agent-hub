export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const embedderEnv = process.env.EMBEDDER ?? "null";

  if (embedderEnv === "local") {
    const { LocalEmbedder } = await import("@/server/embedder/local");
    const { setEmbedder } = await import("@/server/embedder");
    const { startReconciler } = await import("@/server/embedder/reconciler");

    setEmbedder(new LocalEmbedder());
    startReconciler();
  }
}
