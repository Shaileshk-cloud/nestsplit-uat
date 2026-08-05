export function createHouseholdKey({ userId, householdName }) {
  const normalizedHousehold = (householdName ?? "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";

  if (!userId) {
    return normalizedHousehold;
  }

  const normalizedUser = String(userId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "guest";

  return `${normalizedUser}:${normalizedHousehold}`;
}

export function mergeRecentHouseholds(recentHouseholds, nextProfile) {
  const nextKey = createHouseholdKey({
    userId: nextProfile.accountName,
    householdName: nextProfile.householdName,
  });

  const existing = (recentHouseholds || []).filter(Boolean);
  const existingFirst = existing[0];

  if (existingFirst?.key === nextKey) {
    return existing;
  }

  const filtered = existing.filter((entry) => entry?.key !== nextKey);
  return [{ accountName: nextProfile.accountName, householdName: nextProfile.householdName, key: nextKey }, ...filtered].slice(0, 4);
}
