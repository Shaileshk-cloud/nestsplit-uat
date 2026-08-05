export function calculateBalances(expenses, members) {
  const totals = Object.fromEntries(members.map((member) => [member, 0]));

  expenses.forEach((expense) => {
    const participants = expense.participants ?? members;
    const share = expense.amount / participants.length;

    totals[expense.payer] += expense.amount;

    participants.forEach((member) => {
      totals[member] -= share;
    });
  });

  return members.map((member) => ({
    member,
    net: Number((totals[member] || 0).toFixed(2)),
  }));
}

export function summarizeHousehold(expenses, members) {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const averagePerMember = members.length > 0 ? Number((total / members.length).toFixed(2)) : 0;

  const highestExpense = [...expenses].sort((left, right) => right.amount - left.amount)[0] ?? null;

  const payerTotals = Object.fromEntries(members.map((member) => [member, 0]));
  expenses.forEach((expense) => {
    const currentTotal = payerTotals[expense.payer] || 0;
    payerTotals[expense.payer] = currentTotal + expense.amount;
  });

  const topPayer = members
    .map((member) => ({ member, total: payerTotals[member] || 0 }))
    .sort((left, right) => right.total - left.total)[0] ?? { member: members[0] ?? "No members", total: 0 };

  const balances = calculateBalances(expenses, members);
  const largestPositiveBalance = [...balances].sort((left, right) => right.net - left.net)[0] ?? null;
  const largestNegativeBalance = [...balances].filter((item) => item.net < 0).sort((left, right) => left.net - right.net)[0] ?? null;

  return {
    total,
    averagePerMember,
    highestExpense,
    topPayer,
    largestPositiveBalance,
    largestNegativeBalance,
    balances,
  };
}
