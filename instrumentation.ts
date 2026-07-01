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

    setEmbedder(new RemoteEmbedder(url, process.env.EMBEDDER_TOKEN));
    startReconciler();
  } else if (embedderEnv === "stub") {
    // Deterministic, no network/model — for the qa/ e2e harness and
    // integration tests only. Never set this in a dev or production .env.
    const { StubEmbedder } = await import("@/server/embedder/stub");
    const { setEmbedder } = await import("@/server/embedder");
    const { startReconciler } = await import("@/server/embedder/reconciler");

    setEmbedder(new StubEmbedder());
    startReconciler();
  }
}
