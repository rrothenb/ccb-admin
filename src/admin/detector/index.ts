/**
 * Detector entry point. `runDetector` reconciles the three sources, runs the
 * backbone rules, applies remembered resolutions, and returns the tiered
 * worklist plus the clean-sync gate.
 *
 * Resolution memory: the admin's past "yes, I checked this" decisions are passed
 * in as a set of finding keys (`resolvedKeys`). Matching ⚠️/ℹ️ findings are
 * suppressed so the same judgement isn't re-litigated every sync — the guard
 * against false-positive fatigue that trains rubber-stamping. 🛑 block findings
 * are NEVER suppressible: they represent data that must actually change, and
 * once it does the finding simply stops regenerating.
 *
 * Pure module — no GAS. The GAS layer supplies the normalized input and persists
 * `resolvedKeys` (e.g. in script properties) between runs.
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
  /** Finding keys the admin has already resolved — suppresses matching non-block findings. */
  resolvedKeys?: Iterable<string>;
  /** A pre-built reconciliation context, to avoid reconciling twice when the caller also needs it. */
  context?: ReconContext;
}

/** Reconciles + rules + resolution memory → the admin worklist. */
export function runDetector(input: DetectorInput, options: RunOptions = {}): DetectorReport {
  const now = options.now ?? new Date();
  const resolved = new Set(options.resolvedKeys ?? []);

  const ctx = options.context ?? reconcile(input);
  const raw = runRules(ctx, now);

  // Dedup by key (a rule pair could conceivably emit the same finding twice).
  const byKey = new Map<string, Finding>();
  for (const f of raw) {
    if (!byKey.has(f.key)) byKey.set(f.key, f);
  }

  // Suppress resolved findings — but block-tier is never suppressible.
  const findings = [...byKey.values()].filter(
    (f) => f.tier === 'block' || !resolved.has(f.key)
  );

  findings.sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
  );

  const counts: Record<Tier, number> = { block: 0, confirm: 0, fyi: 0 };
  for (const f of findings) counts[f.tier]++;

  return { findings, canSync: counts.block === 0, counts };
}
