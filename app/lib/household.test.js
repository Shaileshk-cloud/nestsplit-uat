import test from "node:test";
import assert from "node:assert/strict";
import { createHouseholdKey, mergeRecentHouseholds } from "./household.js";
import { summarizeHousehold } from "./expense.js";

test("creates a stable key for guest households", () => {
  assert.equal(createHouseholdKey({ householdName: "My Home" }), "my-home");
});

test("includes the user prefix when a user is present", () => {
  assert.equal(createHouseholdKey({ userId: "Mina@example.com", householdName: "My Home" }), "mina-example-com:my-home");
});

test("keeps recent households unique and ordered by most recent use", () => {
  const updated = mergeRecentHouseholds(
    [
      { accountName: "Asha", householdName: "Lake House", key: "asha:lake-house" },
      { accountName: "Mina", householdName: "My Home", key: "mina:my-home" },
    ],
    { accountName: "Mina", householdName: "My Home" },
  );

  assert.deepEqual(updated, [
    { accountName: "Mina", householdName: "My Home", key: "mina:my-home" },
    { accountName: "Asha", householdName: "Lake House", key: "asha:lake-house" },
  ]);
});

test("summarizes the household into meaningful dashboard insights", () => {
  const summary = summarizeHousehold(
    [
      { id: "1", title: "Groceries", amount: 1200, payer: "Asha", participants: ["Asha", "Mina"] },
      { id: "2", title: "Internet", amount: 600, payer: "Mina", participants: ["Asha", "Mina"] },
    ],
    ["Asha", "Mina"],
  );

  assert.equal(summary.total, 1800);
  assert.equal(summary.averagePerMember, 900);
  assert.equal(summary.highestExpense?.title, "Groceries");
  assert.equal(summary.topPayer.member, "Asha");
  assert.equal(summary.largestPositiveBalance?.member, "Asha");
});

test("returns the existing recent-household list when the active profile is already first", () => {
  const existing = [{ accountName: "Mina", householdName: "My Home", key: "mina:my-home" }];
  const updated = mergeRecentHouseholds(existing, { accountName: "Mina", householdName: "My Home" });

  assert.deepEqual(updated, existing);
});
