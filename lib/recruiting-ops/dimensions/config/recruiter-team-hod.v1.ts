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
    teamId: "team_darshan",
    teamName: "Team Darshan",
    hodName: "Darshan Chauhan",
    members: [
      "Simranjeet Srivastava",
      "Kanika Pandey",
      "Darshan Chauhan",
      "Sanoopa AV",
      "Aqsh Bhola",
      "Thanmayee Reddy",
      "Dhairya Rogha",
      "Nikhil Kumar N",
    ],
  },
  {
    teamId: "team_leah",
    teamName: "Team Leah",
    hodName: "Leah Thornton",
    members: [
      "Natesan B",
      "Mitali Soni",
      "Maggie Johnson",
      "Steffan Aguilar",
      "Leah Thornton",
      "Swathi S",
      "Lindsey Begue",
      "Isabella Lopes",
      "Medhavi Yadav",
    ],
  },
  { teamId: "team_luke", teamName: "Team Luke", hodName: "Luke Chilkotowsky", members: ["Luke Chilkotowsky"] },
  { teamId: "team_sam", teamName: "Team Sam", hodName: "Sam Vangelos", members: ["Sam Vangelos"] },
  {
    teamId: "team_bob",
    teamName: "Team Bob",
    hodName: "Bob",
    members: ["Subhashini Rajagopal", "Venu Bangalore", "Dylan Arndt", "Martin Franco"],
  },
  {
    teamId: "team_vinisha",
    teamName: "Team Vinisha",
    hodName: "Vinisha Panwar",
    members: [
      "Vinisha Panwar",
      "Victor Carmona",
      "Rahul Panwar",
      "Nirmala Mohanswamy",
      "Aaliya Naz",
      "Nikita Satralkar",
      "Aayushi Saxena",
      "Karthik Dhandapani",
      "Nelson Rosario",
      "Bruno Deschamps",
      "Ronak Nigam",
      "Aniket Ranjan",
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
