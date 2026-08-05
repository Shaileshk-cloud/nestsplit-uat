import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Expense } from "./sampleData";

export type HouseholdSnapshot = {
  expenses: Expense[];
  members: string[];
  updatedAt: string;
};

const STORAGE_KEY = "nestsplit-household";
export const PROFILE_STORAGE_KEY = "nestsplit-profile";
const TABLE_NAME = "household_state";
const DEFAULT_ROW_ID = "default";

function getStorageKey(householdKey?: string) {
  return householdKey ? `${STORAGE_KEY}:${householdKey}` : STORAGE_KEY;
}

function getRowId(householdKey?: string) {
  return householdKey ?? DEFAULT_ROW_ID;
}

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  supabaseClient = createClient(supabaseUrl, supabasePublishableKey);
  return supabaseClient;
}

function normalizeSnapshot(snapshot: Partial<HouseholdSnapshot> | null | undefined, fallbackMembers: string[], fallbackExpenses: Expense[]): HouseholdSnapshot {
  const members = Array.isArray(snapshot?.members)
    ? snapshot.members.filter((member): member is string => typeof member === "string" && member.trim().length > 0)
    : fallbackMembers;

  const expenses = Array.isArray(snapshot?.expenses)
    ? (snapshot.expenses as Expense[])
    : fallbackExpenses;

  return {
    expenses,
    members,
    updatedAt: snapshot?.updatedAt ?? new Date().toISOString(),
  };
}

export async function loadHouseholdSnapshot(
  fallbackMembers: string[],
  fallbackExpenses: Expense[],
  householdKey = DEFAULT_ROW_ID,
): Promise<HouseholdSnapshot> {
  if (typeof window === "undefined") {
    return normalizeSnapshot(null, fallbackMembers, fallbackExpenses);
  }

  const supabase = getSupabaseClient();
  const rowId = getRowId(householdKey);

  if (supabase) {
    const { data, error } = await supabase.from(TABLE_NAME).select("*").eq("id", rowId).maybeSingle();

    if (!error && data) {
      return normalizeSnapshot(
        {
          expenses: data.expenses as Expense[],
          members: data.members as string[],
          updatedAt: data.updated_at as string,
        },
        fallbackMembers,
        fallbackExpenses,
      );
    }
  }

  const storedValue = window.localStorage.getItem(getStorageKey(householdKey));
  if (!storedValue) {
    return normalizeSnapshot(null, fallbackMembers, fallbackExpenses);
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<HouseholdSnapshot>;
    return normalizeSnapshot(parsed, fallbackMembers, fallbackExpenses);
  } catch {
    return normalizeSnapshot(null, fallbackMembers, fallbackExpenses);
  }
}

export async function saveHouseholdSnapshot(snapshot: HouseholdSnapshot, householdKey = DEFAULT_ROW_ID): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const nextValue = JSON.stringify(snapshot);
  window.localStorage.setItem(getStorageKey(householdKey), nextValue);

  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from(TABLE_NAME).upsert(
    {
      id: getRowId(householdKey),
      expenses: snapshot.expenses,
      members: snapshot.members,
      updated_at: snapshot.updatedAt,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("Could not sync to Supabase", error);
  }
}
