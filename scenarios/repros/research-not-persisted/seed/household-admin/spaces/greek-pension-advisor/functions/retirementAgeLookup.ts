export function retirementAgeLookup(birthYear: number, gender: "male" | "female"): { standardAge: number; earlyAge: number | null; notes: string } {
  // look up the standard and early retirement age by birth year and gender under Greek law

  // Greek social security reforms (esp. 4336/2015 and 4387/2016) harmonised retirement ages.
  // For IKA (private-sector employees), the GENERAL ages are:
  //   - Full pension: age 67 (or 62 with 40 years / 12,000 days of contributions).
  //   - Reduced pension: age 62 with at least 15 years (4,500 days) of contributions.
  // Transitions ran by birth year; by 2022 all remaining transitional windows closed.
  // Women born before 1964 may have earlier ages under pre-reform rules (age 60 with 30 years, or
  // age 55 with 37 years for certain categories), but those are now largely expired.

  // This function returns the GENERAL statutory ages as of the 2016+ regime.
  // It does NOT account for: heavy/hazardous professions, mothers of minors, disability,
  // or special funds (OAEE, OGA, public sector).

  if (birthYear < 1950) {
    return {
      standardAge: 67,
      earlyAge: 62,
      notes: "Born before 1950: already past any transitional window. Standard ages apply unless retired earlier under legacy rules."
    };
  }

  if (birthYear < 1955) {
    return {
      standardAge: 67,
      earlyAge: 62,
      notes: "Transitional windows for this cohort closed by 2022. Standard ages of 67 (full) / 62 (reduced) apply."
    };
  }

  if (birthYear < 1964) {
    // Women born 1955-1963 could retire earlier under pre-reforms if they met conditions by 2012.
    // Today, those windows are shut; they fall under general rules unless vested before deadlines.
    // We still note the legacy possibility.
    return {
      standardAge: 67,
      earlyAge: 62,
      notes: gender === "female"
        ? "Women born 1955-1963 may have vested under pre-reform ages (60/55) if they met contribution thresholds before 2012 cutoffs. Otherwise, standard ages 67/62 apply."
        : "Standard ages 67 (full) / 62 (reduced with 15+ years) apply. Pre-2012 transitional rights may exist if already vested."
    };
  }

  // 1964 and later: full harmonisation
  return {
    standardAge: 67,
    earlyAge: 62,
    notes: "Born 1964 or later: fully under Law 4387/2016. Full pension at 67 (or 62 with 40 years). Reduced pension possible at 62 with at least 15 years (4,500 days)."
  };
}