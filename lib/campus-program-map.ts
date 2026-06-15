/**
 * Maps each PSU program to the campuses where it is offered.
 * Source: PSU Campus-Program Mapping (official document).
 * Used to filter programs when a campus is selected in any view.
 */

/** Normalize a string for fuzzy matching: lowercase, alphanumeric only */
export function normStr(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Raw mapping: program name fragment → campuses that offer it */
const PROGRAM_CAMPUS_MAP: { program: string; campuses: string[] }[] = [
  {
    program: "Bachelor of Arts in Communication",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Arts in Political Science",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-NARRA", "PSU-SAN VICENTE"],
  },
  {
    program: "Bachelor of Arts in Philippine Studies",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Social Work",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Psychology",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Accountancy",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Management Accounting",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Business Administration (Human Resource Management)",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-ARACELI", "PSU-BROOKES POINT", "PSU-QUEZON", "PSU-ROXAS"],
  },
  {
    program: "Bachelor of Science in Business Administration (Business Economics)",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Business Administration (Financial Management)",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-BATARAZA", "PSU-BROOKES POINT", "PSU-CORON", "PSU-NARRA", "PSU-SOFRONIO ESPANOLA"],
  },
  {
    program: "Bachelor of Science in Business Administration (Marketing Management)",
    campuses: ["Main Campus", "PSU-BROOKES POINT", "PSU-CORON", "PSU-NARRA", "PSU-QUEZON", "PSU-TAYTAY"],
  },
  {
    program: "Bachelor of Science in Entrepreneurship",
    campuses: ["Main Campus", "PSU-ARACELI", "PSU-BALABAC", "PSU-DUMARAN", "PSU-EL NIDO", "PSU-NARRA", "PSU-QUEZON", "PSU-RIZAL", "PSU-SAN VICENTE", "PSU-SOFRONIO ESPANOLA"],
  },
  {
    program: "Bachelor of Science in Public Administration",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Criminology",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-BROOKES POINT", "PSU-CORON", "PSU-NARRA", "PSU-ROXAS"],
  },
  {
    program: "Bachelor of Science in Architecture",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Civil Engineering",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Electrical Engineering",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Mechanical Engineering",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Petroleum Engineering",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Hospitality Management",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-BROOKES POINT", "PSU-CORON", "PSU-EL NIDO", "PSU-NARRA", "PSU-QUEZON", "PSU-ROXAS", "PSU-TAYTAY"],
  },
  {
    program: "Bachelor of Science in Tourism Management",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-CORON", "PSU-EL NIDO", "PSU-LINAPACAN", "PSU-NARRA", "PSU-SAN VICENTE"],
  },
  {
    program: "Bachelor of Science in Nursing",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Midwifery",
    campuses: ["Main Campus"],
  },
  {
    program: "Diploma in Midwifery",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Biology",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Marine Biology",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Science in Computer Science",
    campuses: ["Main Campus", "PSU-NARRA", "PSU-RIZAL", "PSU-ROXAS", "PSU-SAN VICENTE"],
  },
  {
    program: "Bachelor of Science in Environmental Science",
    campuses: ["Main Campus", "PSU-RIZAL", "PSU-SAN VICENTE"],
  },
  {
    program: "Bachelor of Science in Information Technology",
    campuses: ["Main Campus", "PSU-BATARAZA", "PSU-BROOKES POINT", "PSU-QUEZON", "PSU-TAYTAY"],
  },
  {
    program: "Bachelor of Elementary Education",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-BATARAZA", "PSU-BROOKES POINT", "PSU-CORON", "PSU-NARRA", "PSU-QUEZON", "PSU-ROXAS", "PSU-SOFRONIO ESPANOLA"],
  },
  {
    program: "Bachelor of Secondary Education",
    campuses: ["Main Campus", "PSU-PCAT CUYO", "PSU-BROOKES POINT", "PSU-CORON", "PSU-QUEZON", "PSU-ROXAS"],
  },
  {
    program: "Bachelor of Physical Education",
    campuses: ["Main Campus"],
  },
  {
    program: "Bachelor of Industrial Technology",
    campuses: ["PSU-PCAT CUYO"],
  },
  {
    program: "Bachelor of Technical-Vocational Teacher Education",
    campuses: ["PSU-PCAT CUYO"],
  },
  {
    program: "Bachelor of Science in Agriculture",
    campuses: ["PSU-BALABAC", "PSU-BATARAZA", "PSU-BROOKES POINT", "PSU-DUMARAN", "PSU-NARRA", "PSU-QUEZON", "PSU-RIZAL", "PSU-SOFRONIO ESPANOLA"],
  },
  {
    program: "Bachelor of Science in Fisheries",
    campuses: ["PSU-LINAPACAN"],
  },
];

/**
 * Given a campus name, return the set of program name fragments
 * (normalized) that are offered at that campus.
 */
export function programsForCampus(campus: string): Set<string> {
  const normCampus = normStr(campus);
  const matches = new Set<string>();
  for (const entry of PROGRAM_CAMPUS_MAP) {
    const offered = entry.campuses.some(c => normStr(c) === normCampus);
    if (offered) matches.add(normStr(entry.program));
  }
  return matches;
}

/**
 * Returns true if the given program name (from DB) is offered at the given campus.
 * Matches by checking if the normalized DB name starts with or contains
 * any known program fragment offered at that campus.
 */
export function isProgramAtCampus(dbProgramName: string, campus: string): boolean {
  if (!campus) return true; // no campus filter = show all
  const normDb = normStr(dbProgramName);
  const normCampus = normStr(campus);
  for (const entry of PROGRAM_CAMPUS_MAP) {
    const offered = entry.campuses.some(c => normStr(c) === normCampus);
    if (!offered) continue;
    // Check if DB program name contains this entry's key terms
    const normFragment = normStr(entry.program);
    if (normDb.includes(normFragment.slice(0, 30)) || normFragment.includes(normDb.slice(0, 30))) {
      return true;
    }
  }
  return false;
}

/**
 * Given a program name (from DB), return all campuses where it is offered.
 */
export function campusesForProgram(dbProgramName: string): string[] {
  const normDb = normStr(dbProgramName);
  for (const entry of PROGRAM_CAMPUS_MAP) {
    const normFragment = normStr(entry.program);
    if (normDb.includes(normFragment.slice(0, 30)) || normFragment.includes(normDb.slice(0, 30))) {
      return entry.campuses;
    }
  }
  return []; // unknown program — show at all campuses (don't restrict)
}
