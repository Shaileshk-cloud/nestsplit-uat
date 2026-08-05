export function getMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en", { month: "short", year: "numeric" });
}

function parseExpenseDate(expense) {
  if (!expense?.date) {
    return null;
  }

  const parsed = new Date(expense.date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeCategory(value) {
  const trimmed = String(value || "Other").trim();
  return trimmed || "Other";
}

function normalizeExpense(expense) {
  const amount = Number(expense?.amount) || 0;
  return {
    ...expense,
    amount,
    category: normalizeCategory(expense?.category),
  };
}

function getDateWindow(expenses, range) {
  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), 1);

  if (range === "All") {
    const relevantDates = (expenses || [])
      .map(parseExpenseDate)
      .filter(Boolean)
      .sort((left, right) => left - right);

    if (relevantDates.length === 0) {
      return { startDate: null, endDate };
    }

    const startDate = new Date(relevantDates[0].getFullYear(), relevantDates[0].getMonth(), 1);
    return { startDate, endDate };
  }

  const monthsBack = range === "3M" ? 3 : range === "1Y" ? 12 : 6;
  const startDate = new Date(endDate.getFullYear(), endDate.getMonth() - monthsBack + 1, 1);
  return { startDate, endDate };
}

function buildMonthRange(startDate, endDate) {
  const months = [];
  if (!startDate) {
    return months;
  }

  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  while (cursor <= endDate) {
    months.push(getMonthKey(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return months;
}

export function filterExpenses(expenses, range) {
  const { startDate, endDate } = getDateWindow(expenses, range);
  const normalized = (expenses || []).map(normalizeExpense).filter((expense) => {
    const parsedDate = parseExpenseDate(expense);
    if (!parsedDate) {
      return false;
    }

    if (startDate && parsedDate < startDate) {
      return false;
    }

    return parsedDate <= endDate;
  });

  return normalized;
}

export function buildMonthlySeries(expenses, range) {
  const { startDate, endDate } = getDateWindow(expenses, range);
  const monthKeys = buildMonthRange(startDate, endDate);
  const totalByMonth = new Map();

  monthKeys.forEach((key) => totalByMonth.set(key, 0));

  expenses.forEach((expense) => {
    const parsedDate = parseExpenseDate(expense);
    if (!parsedDate) {
      return;
    }

    const monthKey = getMonthKey(parsedDate);
    if (!totalByMonth.has(monthKey)) {
      totalByMonth.set(monthKey, 0);
    }

    totalByMonth.set(monthKey, (totalByMonth.get(monthKey) || 0) + expense.amount);
  });

  return monthKeys.map((monthKey) => ({
    key: monthKey,
    month: formatMonthLabel(monthKey),
    total: Number((totalByMonth.get(monthKey) || 0).toFixed(2)),
  }));
}

function buildCategorySeries(expenses) {
  const totals = new Map();

  expenses.forEach((expense) => {
    const category = normalizeCategory(expense.category);
    totals.set(category, (totals.get(category) || 0) + expense.amount);
  });

  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total: Number(total.toFixed(2)) }))
    .sort((left, right) => right.total - left.total);
}

function buildMemberSeries(expenses, members) {
  const totals = Object.fromEntries((members || []).map((member) => [member, 0]));

  expenses.forEach((expense) => {
    const payer = expense.payer || "Unknown";
    totals[payer] = (totals[payer] || 0) + expense.amount;
  });

  return Object.entries(totals)
    .map(([member, total]) => ({ member, total: Number(total.toFixed(2)) }))
    .sort((left, right) => right.total - left.total);
}

function buildFairShareSeries(expenses, members) {
  const totals = Object.fromEntries((members || []).map((member) => [member, 0]));

  expenses.forEach((expense) => {
    const participants = Array.isArray(expense.participants) && expense.participants.length > 0 ? expense.participants : members || [];
    const share = expense.amount / participants.length;

    participants.forEach((member) => {
      totals[member] = (totals[member] || 0) + share;
    });
  });

  return Object.entries(totals)
    .map(([member, total]) => ({ member, fairShare: Number(total.toFixed(2)) }))
    .sort((left, right) => right.fairShare - left.fairShare);
}

function buildCategoryTrend(expenses, category, range) {
  const filtered = expenses.filter((expense) => normalizeCategory(expense.category) === category);
  return buildMonthlySeries(filtered, range);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function calculateChangePercent(current, previous) {
  if (!previous || previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function buildInsights(monthlySeries, categorySeries, topExpenses, memberSeries) {
  const currentMonth = monthlySeries[monthlySeries.length - 1];
  const previousMonth = monthlySeries[monthlySeries.length - 2] || null;
  const latestCategory = categorySeries[0];
  const highestMonth = monthlySeries.slice().sort((left, right) => right.total - left.total)[0];

  const currentMonthValue = currentMonth?.total || 0;
  const previousMonthValue = previousMonth?.total || 0;
  const changePercent = calculateChangePercent(currentMonthValue, previousMonthValue);

  const insightLines = [];

  if (monthlySeries.length === 0) {
    insightLines.push("Add a few expenses to unlock your first insights.");
    return insightLines;
  }

  insightLines.push(
    changePercent >= 0
      ? `You spent ${Math.abs(changePercent)}% ${changePercent === 0 ? "about the same as" : "more than"} last month.`
      : `You spent ${Math.abs(changePercent)}% less than last month.`,
  );

  if (latestCategory) {
    insightLines.push(`${latestCategory.category} was the largest expense category.`);
  }

  if (highestMonth) {
    insightLines.push(`${highestMonth.month} was the highest-spending month in the selected range.`);
  }

  if (memberSeries.length > 0) {
    const largestContributor = memberSeries[0];
    insightLines.push(`${largestContributor.member} made the largest contribution this period.`);
  }

  if (topExpenses[0]) {
    insightLines.push(`${topExpenses[0].title} was your biggest single expense.`);
  }

  return insightLines;
}

export function buildAnalytics(expenses, members, range) {
  const filteredExpenses = filterExpenses(expenses, range);
  const monthlySeries = buildMonthlySeries(filteredExpenses, range);
  const categorySeries = buildCategorySeries(filteredExpenses);
  const memberSeries = buildMemberSeries(filteredExpenses, members || []);
  const fairShareSeries = buildFairShareSeries(filteredExpenses, members || []);
  const averageMonthlySpend = monthlySeries.length > 0
    ? Number((monthlySeries.reduce((sum, item) => sum + item.total, 0) / monthlySeries.length).toFixed(2))
    : 0;

  const highestSpendingMonth = monthlySeries.slice().sort((left, right) => right.total - left.total)[0] || null;
  const lowestSpendingMonth = monthlySeries.slice().sort((left, right) => left.total - right.total)[0] || null;
  const topExpenses = filteredExpenses
    .slice()
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5)
    .map((expense) => ({
      ...expense,
      month: expense.date ? formatMonthLabel(getMonthKey(parseExpenseDate(expense) || new Date())) : "Unknown",
    }));

  const defaultCategory = categorySeries[0]?.category || "Other";
  const categoryTrend = buildCategoryTrend(filteredExpenses, defaultCategory, range);

  return {
    range,
    monthlySeries,
    categorySeries,
    memberSeries,
    fairShareSeries,
    averageMonthlySpend,
    highestSpendingMonth,
    lowestSpendingMonth,
    topExpenses,
    categoryOptions: categorySeries.map((entry) => entry.category),
    categoryTrend,
    defaultCategory,
    totalSpend: filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0),
    insights: buildInsights(monthlySeries, categorySeries, topExpenses, memberSeries),
    formatCurrency,
  };
}
