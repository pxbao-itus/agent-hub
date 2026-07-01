export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const embedderEnv = process.env.EMBEDDER ?? "null";

  if (embedderEnv === "local") {
    const { LocalEmbedder } = await import("@/server/embedder/local");
    const { setEmbedder } = await import("@/server/embedder");
    const { startReconciler } = await import("@/server/embedder/reconciler");

    setEmbedder(new LocalEmbedder());
    startReconciler();
  } else if (embedderEnv === "remote") {
    const url = process.env.EMBEDDER_URL;
    if (!url) {
      throw new Error("EMBEDDER=remote requires EMBEDDER_URL to be set");
    }

    const { RemoteEmbedder } = await import("@/server/embedder/remote");
    const { setEmbedder } = await import("@/server/embedder");
    const { startReconciler } = await import("@/server/embedder/reconciler");

    setEmbedder(new RemoteEmbedder(url));
    startReconciler();
  }
}
