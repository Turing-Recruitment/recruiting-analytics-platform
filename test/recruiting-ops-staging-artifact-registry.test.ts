import { describe, expect, test } from "vitest"

import {
  STAGING_HYDRATION_GLOBAL_FLAG,
  getStagingArtifact,
  requireStagingMutationTarget,
  stagingArtifactRegistry,
  stagingHydrationEnabled,
} from "../lib/recruiting-ops/delivery/staging-artifact-registry"

const NOW = Date.parse("2026-07-11T20:00:00.000Z")

describe("staging artifact mutation registry", () => {
  test("binds every canonical target exactly once and never contains a retired copy id", () => {
    expect(stagingArtifactRegistry).toHaveLength(11)
    expect(new Set(stagingArtifactRegistry.map((artifact) => artifact.key)).size).toBe(11)
    expect(new Set(stagingArtifactRegistry.map((artifact) => artifact.artifactId)).size).toBe(11)
    expect(stagingArtifactRegistry.every((artifact) => artifact.mutationTarget === "canonical")).toBe(true)
    // Per Sam's 2026-08-06 canonical-cutover directive, the registry now binds
    // the canonical ids directly.
    expect(stagingArtifactRegistry.map((artifact) => artifact.artifactId)).toContain(
      "1Yp0E7IgBbh800Wx8LAKsQk1X1qQ80bseDU70CTUMe7E"
    )
    expect(stagingArtifactRegistry.map((artifact) => artifact.artifactId)).toContain(
      "1wTHFRUSOri_qTte5UYEmooTAsfu9kT2H6PCuKqB8v7I"
    )
    // The retired Sam-owned copies must never reappear as a mutation target.
    expect(stagingArtifactRegistry.map((artifact) => artifact.artifactId)).not.toContain(
      "1FKy--WUEPKOgCpVigjduOTcxp4X7EUYnn2NrHCIQA4o"
    )
    expect(stagingArtifactRegistry.map((artifact) => artifact.artifactId)).not.toContain(
      "1LbZZ9GSacGrZqhKisjfMSvps7yYPrTFLaCUScObdWz8"
    )
  })

  test("requires key, id, and kind to resolve to the same staging entry", () => {
    const artifact = getStagingArtifact("weekly_progress")
    expect(
      requireStagingMutationTarget({
        key: artifact.key,
        artifactId: artifact.artifactId,
        kind: artifact.kind,
      })
    ).toEqual(artifact)

    expect(() =>
      requireStagingMutationTarget({
        key: "weekly_progress",
        artifactId: "1wTHFRUSOri_qTte5UYEmooTAsfu9kT2H6PCuKqB8v7I",
        kind: "google_sheet",
      })
    ).toThrow("exact registered staging artifact")
    expect(() =>
      requireStagingMutationTarget({
        key: "elt_doc",
        artifactId: getStagingArtifact("elt_doc").artifactId,
        kind: "google_sheet",
      })
    ).toThrow("exact registered staging artifact")
  })

  test("requires exact durable tier flags until an operator changes them", () => {
    const artifact = getStagingArtifact("all_hires")
    expect(stagingHydrationEnabled("all_hires", NOW, {})).toBe(false)
    expect(
      stagingHydrationEnabled("all_hires", NOW, {
        [STAGING_HYDRATION_GLOBAL_FLAG]: "TRUE",
        [artifact.hydrationFlag]: "true",
      })
    ).toBe(false)
    expect(
      stagingHydrationEnabled("all_hires", NOW, {
        [STAGING_HYDRATION_GLOBAL_FLAG]: "true",
        [artifact.hydrationFlag]: "1",
      })
    ).toBe(false)
    expect(
      stagingHydrationEnabled("all_hires", NOW, {
        [STAGING_HYDRATION_GLOBAL_FLAG]: "true",
        [artifact.hydrationFlag]: "true",
      })
    ).toBe(true)
    expect(stagingHydrationEnabled("all_hires", Number.NaN, {
      [STAGING_HYDRATION_GLOBAL_FLAG]: "true",
      [artifact.hydrationFlag]: "true",
    })).toBe(false)
  })
})
