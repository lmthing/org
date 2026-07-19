export function calculateMonthlyInterest(balance: number, annualRate: number): { interest: number; principal: number; totalPayment: number } {
  // compute interest portion of next payment given balance and annual rate
  // Standard amortization: monthly interest = outstanding balance × (annual rate / 12)
  // For the Filolaou 41 mortgage: €148,200 at 3.1% → interest ≈ €382.85
  const monthlyRate = annualRate / 12;
  const interest = parseFloat((balance * monthlyRate).toFixed(2));
  // Assume the fixed monthly payment from the loan data (€1,042); principal = payment - interest
  const totalPayment = 1042;
  const principal = parseFloat((totalPayment - interest).toFixed(2));
  return { interest, principal, totalPayment };
}