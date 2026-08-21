import type {
  StagingArtifactKey,
  StagingArtifactKind,
} from "./staging-artifact-registry"

export interface CanonicalParityArtifact {
  readonly key: StagingArtifactKey
  readonly kind: StagingArtifactKind
  readonly artifactId: string
  readonly purpose: "manual_comparison_baseline"
  readonly readOnly: true
  readonly writeEligible: false
}

/**
 * Manual artifacts used only as read-only comparison baselines while their
 * copied counterparts are exercised. These ids are intentionally isolated
 * from the staging mutation registry and must never be accepted by a Google
 * mutation boundary.
 */
export const canonicalParityRegistry = Object.freeze([
  baseline("elt_doc", "google_doc", "1Yp0E7IgBbh800Wx8LAKsQk1X1qQ80bseDU70CTUMe7E"),
  baseline("weekly_recruitment", "google_sheet", "1MJbvs5xh89qh_0FTsNEN_cTdML57mFEAbLLOJNdmD_I"),
  baseline("weekly_progress", "google_sheet", "17xg8CtSeWET-S7c1Xcoup7YJXCnn15p_O-IOmVQKuxs"),
  baseline("all_hires", "google_sheet", "1PDyEkAlMRSkSPgOFunVuGUFejnUwX1YG4kGlbnyHijM"),
  baseline("pipeline_890", "google_sheet", "1wTHFRUSOri_qTte5UYEmooTAsfu9kT2H6PCuKqB8v7I"),
  baseline("pipeline_907", "google_sheet", "1g0hCK53tJ03FgxUNNK4lizh1vUgOMWJjTg0vGWF_7M8"),
  baseline("pipeline_1026_1027", "google_sheet", "1z8zVQYrf_zc0bqq_uV5-ywS1AuyTDzLDO_4HnU3-oEk"),
  baseline("pipeline_1118_1119", "google_sheet", "1awdYMTrgxBq70Z56eAJCo4w5ix-S4aqMyV6_t7s9wSM"),
  baseline("final_offer", "google_sheet", "18630K9pIfuqvIqLDN1ItC37pgs0SqZ-lmv9JQHU4uGo"),
  baseline("rps_tracking", "google_sheet", "1FrZlJj96-yXVdZltN3TcfLy9K_m6i_tFfrBgQGSoZEY"),
  baseline("delivery_roles_rps", "google_sheet", "1j9teESHnERTm1mmq7jDiI7qyZ3ygnzvaCbtLXdkzC3M"),
] as const) satisfies readonly CanonicalParityArtifact[]

const byKey = new Map(canonicalParityRegistry.map((artifact) => [artifact.key, artifact]))

/** Read-only lookup for comparison readers. There is deliberately no mutation resolver. */
export function getCanonicalParityArtifact(key: StagingArtifactKey): CanonicalParityArtifact {
  const artifact = byKey.get(key)
  if (!artifact) throw new Error(`Unknown canonical parity artifact key: ${key}`)
  return artifact
}

function baseline(
  key: StagingArtifactKey,
  kind: StagingArtifactKind,
  artifactId: string
): CanonicalParityArtifact {
  return Object.freeze({
    key,
    kind,
    artifactId,
    purpose: "manual_comparison_baseline",
    readOnly: true,
    writeEligible: false,
  })
}
