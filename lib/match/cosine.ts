import { perfCounters } from "@/lib/perf/counters";
/**
 * Cosine similarity, written by hand (no library).
 *
 * cos(a, b) = (a · b) / (|a| * |b|)
 *
 * It measures the angle between two vectors, ignoring their length: 1 = same direction
 * (very similar meaning), 0 = unrelated, -1 = opposite. We use it to compare the embedding of
 * the patient's standardized profile with each trial's embedding.
 *
 * Works with any numeric array type, including Float32Array (query) and Int8Array (stored,
 * quantized trial vectors). Because cosine ignores length, the int8 scale factor cancels out.
 */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  perfCounters.cosine++;
  // Vectors must live in the same space (same number of dimensions).
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }

  let dot = 0; // running sum of a[i] * b[i]  -> the dot product a · b
  let normA = 0; // running sum of a[i]^2      -> |a|^2
  let normB = 0; // running sum of b[i]^2      -> |b|^2

  // One pass over every dimension accumulates all three sums.
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number; // index is in range, so this is a number
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  // A zero vector has no direction; define its similarity as 0 instead of dividing by zero.
  if (normA === 0 || normB === 0) return 0;

  // Divide the dot product by the product of the lengths (square roots of the squared norms).
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cosine similarity of `query` against row `row` of a flat row-major matrix (e.g. a shard's
 * Int8Array of N x dims embeddings), without copying the row out.
 */
export function cosineSimilarityRow(query: ArrayLike<number>, matrix: ArrayLike<number>, row: number, dims: number): number {
  const offset = row * dims; // where this row starts in the flat array
  let dot = 0;
  let normQ = 0;
  let normR = 0;
  for (let i = 0; i < dims; i++) {
    const q = query[i] as number;
    const r = matrix[offset + i] as number;
    dot += q * r;
    normQ += q * q;
    normR += r * r;
  }
  if (normQ === 0 || normR === 0) return 0;
  return dot / (Math.sqrt(normQ) * Math.sqrt(normR));
}
