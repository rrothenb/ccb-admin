/**
 * Detector entry point. `runDetector` reconciles the three sources, runs the
 * backbone rules, and returns the tiered worklist plus the clean-sync gate.
 *
 * The worklist is stateless: every run is fresh. There is no "resolve/suppress"
 * feature — if the admin fixes something, they simply re-run the whole process
 * and the finding either stays (still wrong) or is gone (fixed).
 *
 * Pure module — no GAS. The GAS layer supplies the normalized input.
 */

import { DetectorInput, DetectorReport, Finding, Tier } from './types';
import { reconcile, ReconContext } from './match';
import { runRules } from './rules';

export * from './types';
export { reconcile } from './match';
export type { ReconContext, MasterLink, SiblingGroup } from './match';

/** Sort order for tiers — most urgent first. */
const TIER_RANK: Record<Tier, number> = { block: 0, confirm: 1, fyi: 2 };

export interface RunOptions {
  /** Injected clock for deterministic "still active?" checks. */
  now?: Date;
  /** A pre-built reconciliation context, to avoid reconciling twice when the caller also needs it. */
  context?: ReconContext;
}

/** Reconciles + rules → the admin worklist (stateless; no resolution memory). */
export function runDetector(input: DetectorInput, options: RunOptions = {}): DetectorReport {
  const now = options.now ?? new Date();

  const ctx = options.context ?? reconcile(input);
  const raw = runRules(ctx, now);

  // Dedup by key (a rule pair could conceivably emit the same finding twice).
  const byKey = new Map<string, Finding>();
  for (const f of raw) {
    if (!byKey.has(f.key)) byKey.set(f.key, f);
  }

  const findings = [...byKey.values()];
  findings.sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
  );

  const counts: Record<Tier, number> = { block: 0, confirm: 0, fyi: 0 };
  for (const f of findings) counts[f.tier]++;

  return { findings, canSync: counts.block === 0, counts };
}
