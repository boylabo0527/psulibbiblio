/**
 * Local sentence embeddings via transformers.js — no external API key, no
 * per-request cost. Runs a small quantized ONNX model (all-MiniLM-L6-v2, a
 * few MB) directly in the Node.js serverless function.
 *
 * The model is downloaded from the Hugging Face Hub on first use and cached
 * in /tmp (the only writable directory in a Vercel serverless function), so
 * the first invocation after a cold start is slow; warm invocations reuse
 * the already-loaded pipeline via the module-level singleton below.
 *
 * Set MATCH_USE_EMBEDDINGS=false to disable this entirely and fall back to
 * BM25-only matching (e.g. if this turns out to be too slow/heavy in
 * practice on a free-tier deployment) — no redeploy required, just an env
 * var change, since this is a plain (non-NEXT_PUBLIC_) server variable.
 */
import type { FeatureExtractionPipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export function embeddingsEnabled(): boolean {
  return (process.env.MATCH_USE_EMBEDDINGS ?? "true").toLowerCase() !== "false";
}

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Vercel's deployed function filesystem is read-only outside /tmp.
      env.cacheDir = "/tmp/.transformers-cache";
      return pipeline<"feature-extraction">("feature-extraction", MODEL_ID, { dtype: "q8" });
    })();
  }
  return extractorPromise;
}

/** Embed a batch of texts, returning one L2-normalized vector per input. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist() as number[][];
}

/** Cosine similarity for two already-L2-normalized vectors (just the dot product). */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, dot);
}
