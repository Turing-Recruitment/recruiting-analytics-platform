import { describe, expect, test } from "vitest"

import {
  canonicalParityRegistry,
  getCanonicalParityArtifact,
} from "../lib/recruiting-ops/delivery/canonical-parity-registry"
import {
  requireStagingMutationTarget,
  stagingArtifactRegistry,
} from "../lib/recruiting-ops/delivery/staging-artifact-registry"

const expectedCanonicalIds = {
  elt_doc: "1Yp0E7IgBbh800Wx8LAKsQk1X1qQ80bseDU70CTUMe7E",
  weekly_recruitment: "1MJbvs5xh89qh_0FTsNEN_cTdML57mFEAbLLOJNdmD_I",
  weekly_progress: "17xg8CtSeWET-S7c1Xcoup7YJXCnn15p_O-IOmVQKuxs",
  all_hires: "1PDyEkAlMRSkSPgOFunVuGUFejnUwX1YG4kGlbnyHijM",
  pipeline_890: "1wTHFRUSOri_qTte5UYEmooTAsfu9kT2H6PCuKqB8v7I",
  pipeline_907: "1g0hCK53tJ03FgxUNNK4lizh1vUgOMWJjTg0vGWF_7M8",
  pipeline_1026_1027: "1z8zVQYrf_zc0bqq_uV5-ywS1AuyTDzLDO_4HnU3-oEk",
  pipeline_1118_1119: "1awdYMTrgxBq70Z56eAJCo4w5ix-S4aqMyV6_t7s9wSM",
  final_offer: "18630K9pIfuqvIqLDN1ItC37pgs0SqZ-lmv9JQHU4uGo",
  rps_tracking: "1FrZlJj96-yXVdZltN3TcfLy9K_m6i_tFfrBgQGSoZEY",
  delivery_roles_rps: "1j9teESHnERTm1mmq7jDiI7qyZ3ygnzvaCbtLXdkzC3M",
} as const

describe("canonical parity registry", () => {
  test("registers all eleven manual baselines as comparison-only", () => {
    expect(canonicalParityRegistry).toHaveLength(11)
    expect(Object.fromEntries(canonicalParityRegistry.map((artifact) => [artifact.key, artifact.artifactId]))).toEqual(
      expectedCanonicalIds
    )
    expect(new Set(canonicalParityRegistry.map((artifact) => artifact.key)).size).toBe(11)
    expect(new Set(canonicalParityRegistry.map((artifact) => artifact.artifactId)).size).toBe(11)
    expect(Object.isFrozen(canonicalParityRegistry)).toBe(true)
    expect(canonicalParityRegistry.every(Object.isFrozen)).toBe(true)
    expect(
      canonicalParityRegistry.every(
        (artifact) =>
          artifact.readOnly === true &&
          artifact.writeEligible === false &&
          artifact.purpose === "manual_comparison_baseline"
      )
    ).toBe(true)
  })

  // Per Sam's 2026-08-06 canonical-cutover directive, the mutation registry
  // (lib/recruiting-ops/delivery/staging-artifact-registry.ts) now binds
  // these exact canonical ids directly, so every one of them now resolves as
  // the exact registered mutation target instead of being denied.
  const RETIRED_COPY_IDS = {
    elt_doc: "1FKy--WUEPKOgCpVigjduOTcxp4X7EUYnn2NrHCIQA4o",
    weekly_recruitment: "1rjq6EjsTO2UxM9JLJigBvRl2Ny8EsRvwhyWw7Y_5VCA",
    weekly_progress: "1gg7yFrUoYjM14KlMq4y3Und81N6KwDcTdsoTn7m9Pqo",
    all_hires: "1akHN14SE6BPHvYcHuOmMx1G8UWE5WObz2jJSeO9HXWs",
    pipeline_890: "1LbZZ9GSacGrZqhKisjfMSvps7yYPrTFLaCUScObdWz8",
    pipeline_907: "1Za8KtxKZMIlZGb35VIfmU1UByXaThwJLRPkvCigrE48",
    pipeline_1026_1027: "1c1hzvXlrI3DtPIyearpz9rC9xXcE0ipByy-pTcHxmpA",
    pipeline_1118_1119: "1nbVSqVLy1Pim2sODQFsPvY_E4liQ7K35BH_8v-sf6o4",
    final_offer: "13-lJ90ua80Ia3cx8aKSdrs9Yv-R4ukePLIXu7hlF7eU",
    rps_tracking: "1KvWJnCtnIDhRRWPxktbn90cCCtQMdg-5DnZhKLMPfLg",
    delivery_roles_rps: "1Ga274ix5MlkiNU_o_X0SrruKtobzgoVoxmux6JeYa0k",
  } as const

  test("every canonical id is now the exact bound mutation target (post-cutover)", () => {
    const stagingIds = new Set(stagingArtifactRegistry.map((artifact) => artifact.artifactId))
    for (const canonical of canonicalParityRegistry) {
      expect(stagingIds.has(canonical.artifactId)).toBe(true)
      expect(
        requireStagingMutationTarget({
          key: canonical.key,
          artifactId: canonical.artifactId,
          kind: canonical.kind,
        })
      ).toMatchObject({ key: canonical.key, artifactId: canonical.artifactId })
    }
  })

  test("every retired copy id is now structurally denied by the mutation resolver", () => {
    const stagingIds = new Set(stagingArtifactRegistry.map((artifact) => artifact.artifactId))
    for (const [key, retiredId] of Object.entries(RETIRED_COPY_IDS)) {
      expect(stagingIds.has(retiredId)).toBe(false)
      expect(() =>
        requireStagingMutationTarget({
          key: key as keyof typeof RETIRED_COPY_IDS,
          artifactId: retiredId,
          kind: getCanonicalParityArtifact(key as keyof typeof RETIRED_COPY_IDS).kind,
        })
      ).toThrow("exact registered staging artifact")
    }
  })

  test("looks up baselines by the same stable artifact key used by copied targets", () => {
    expect(getCanonicalParityArtifact("all_hires")).toMatchObject({
      artifactId: expectedCanonicalIds.all_hires,
      kind: "google_sheet",
      readOnly: true,
      writeEligible: false,
    })
  })
})
