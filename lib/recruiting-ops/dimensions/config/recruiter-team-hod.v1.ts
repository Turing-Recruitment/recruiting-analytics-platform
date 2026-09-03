/**
 * Recruiter → team → HOD mapping, FIXTURE/SEED ONLY (v1).
 *
 * Transcribed from the hand-edited `CASE WHEN ... THEN 'Team X'` statements that
 * recur across the handover queries (Role assignment by pod, Final Offer Report,
 * RPS tracking). It is versioned config, not live data: any recruiter not listed
 * resolves to an `unresolved` defect rather than a sentinel. A later pass can
 * replace this with a resolved Greenhouse-backed dimension; the resolver contract
 * does not change.
 */

export const RECRUITER_TEAM_HOD_CONFIG_VERSION = "v1-2026-06"

export interface RecruiterTeamHodEntry {
  recruiterName: string
  teamId: string
  teamName: string
  hodName: string
}

const TEAMS: ReadonlyArray<{ teamId: string; teamName: string; hodName: string; members: readonly string[] }> = [
  {
    teamId: "team_arden",
    teamName: "Team Arden",
    hodName: "Arden Vale",
    members: [
      "Sasha Winter",
      "Kendra Pace",
      "Arden Vale",
      "Sonia Avery",
      "Ash Bloom",
      "Thea Rowe",
      "Dara Rhodes",
      "Nico Kane",
    ],
  },
  {
    teamId: "team_lena",
    teamName: "Team Lena",
    hodName: "Lena Trask",
    members: [
      "Noel Barrett",
      "Mira Sloan",
      "Marge Jensen",
      "Sten Archer",
      "Lena Trask",
      "Sable Stone",
      "Linden Brook",
      "Isla Lane",
      "Meda York",
    ],
  },
  { teamId: "team_lucas", teamName: "Team Lucas", hodName: "Lucas Chandler", members: ["Lucas Chandler"] },
  { teamId: "team_sam", teamName: "Team Sam", hodName: "Sam Vangelos", members: ["Sam Vangelos"] },
  {
    teamId: "team_bob",
    teamName: "Team Bob",
    hodName: "Bob",
    members: ["Sadie Rune", "Vero Bay", "Dell Ames", "Marlon Frost"],
  },
  {
    teamId: "team_vera",
    teamName: "Team Vera",
    hodName: "Vera Pond",
    members: [
      "Vera Pond",
      "Vic Cole",
      "Remy Park",
      "Nima Moss",
      "Alia North",
      "Nika Sorel",
      "Ayla Sage",
      "Karl Dane",
      "Nels Rio",
      "Bram Dell",
      "Rone Nash",
      "Anik Rand",
    ],
  },
]

export const recruiterTeamHodConfigV1: readonly RecruiterTeamHodEntry[] = TEAMS.flatMap((team) =>
  team.members.map((recruiterName) => ({
    recruiterName,
    teamId: team.teamId,
    teamName: team.teamName,
    hodName: team.hodName,
  }))
)
