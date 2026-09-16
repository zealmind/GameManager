/** True when a completed game score is valid (11+ to win, by 2 or 11-10 golden point). */
export function isValidGameScore(team1: number, team2: number): boolean {
  const high = Math.max(team1, team2);
  const low = Math.min(team1, team2);
  if (high < 11) return false;
  if (high - low >= 2) return true;
  return high === 11 && low === 10;
}
