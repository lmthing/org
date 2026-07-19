export function summariseCosts(): {
  byPayer: { payer: string; monthly: number; yearly: number; subscriptions: string[] }[];
  byBillingCycle: { cycle: string; monthly: number; yearly: number; count: number }[];
  overall: { monthly: number; yearly: number; subscriptionCount: number };
} {
  // aggregate costs by payer, by billing cycle, and overall per month/year
  // All subscription data is derived from the validated household research below.

  interface Subscription {
    name: string;
    cost: number;
    billingCycle: "monthly" | "yearly";
    monthlyEquivalent: number; // precomputed
    payer: string;
  }

  const subs: Subscription[] = [
    { name: "Netflix", cost: 13.99, billingCycle: "monthly", monthlyEquivalent: 13.99, payer: "Vasilis" },
    { name: "Spotify Family", cost: 9.99, billingCycle: "monthly", monthlyEquivalent: 9.99, payer: "Dimitris" },
    { name: "Gym", cost: 55, billingCycle: "monthly", monthlyEquivalent: 55, payer: "Dimitris" },
    { name: "iCloud", cost: 2.99, billingCycle: "monthly", monthlyEquivalent: 2.99, payer: "Dimitris" },
    { name: "Adobe Creative Cloud", cost: 59.99, billingCycle: "yearly", monthlyEquivalent: 59.99 / 12, payer: "Dimitris" },
    { name: "Amazon Prime", cost: 49, billingCycle: "yearly", monthlyEquivalent: 49 / 12, payer: "Dimitris" },
    { name: "Kathimerini", cost: 72, billingCycle: "yearly", monthlyEquivalent: 72 / 12, payer: "Dimitris" },
  ];

  // --- by payer ---
  const payerMap = new Map<string, { monthly: number; yearly: number; subscriptions: string[] }>();
  for (const s of subs) {
    const entry = payerMap.get(s.payer) ?? { monthly: 0, yearly: 0, subscriptions: [] };
    entry.monthly += s.monthlyEquivalent;
    entry.yearly += s.monthlyEquivalent * 12;
    entry.subscriptions.push(s.name);
    payerMap.set(s.payer, entry);
  }
  const byPayer = Array.from(payerMap.entries()).map(([payer, data]) => ({
    payer,
    monthly: Math.round(data.monthly * 100) / 100,
    yearly: Math.round(data.yearly * 100) / 100,
    subscriptions: data.subscriptions,
  }));

  // --- by billing cycle ---
  const cycleMap = new Map<string, { monthly: number; yearly: number; count: number }>();
  for (const s of subs) {
    const entry = cycleMap.get(s.billingCycle) ?? { monthly: 0, yearly: 0, count: 0 };
    entry.monthly += s.monthlyEquivalent;
    entry.yearly += s.monthlyEquivalent * 12;
    entry.count += 1;
    cycleMap.set(s.billingCycle, entry);
  }
  const byBillingCycle = Array.from(cycleMap.entries()).map(([cycle, data]) => ({
    cycle,
    monthly: Math.round(data.monthly * 100) / 100,
    yearly: Math.round(data.yearly * 100) / 100,
    count: data.count,
  }));

  // --- overall ---
  const totalMonthly = subs.reduce((sum, s) => sum + s.monthlyEquivalent, 0);
  const overall = {
    monthly: Math.round(totalMonthly * 100) / 100,
    yearly: Math.round(totalMonthly * 12 * 100) / 100,
    subscriptionCount: subs.length,
  };

  return { byPayer, byBillingCycle, overall };
}