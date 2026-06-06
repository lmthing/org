export function checkPot(): { boiling: boolean; temperature: number } {
  const temp = Math.floor(Math.random() * 100) + 20;
  return { boiling: temp >= 100, temperature: temp };
}
