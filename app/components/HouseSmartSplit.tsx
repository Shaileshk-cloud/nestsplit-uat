"use client";

/**
 * HouseSmartSplit — Add Expense sheet with four split modes.
 *
 * Split modes:
 *   equal      — amount divided evenly; last participant absorbs paise remainder
 *   exact      — user enters each participant's amount; total must equal expense
 *   percentage — user enters each participant's %; total must equal 100
 *   shares     — user enters unitless weights; amounts derived proportionally
 *
 * All monetary arithmetic uses integer paise (bigint) to avoid float drift.
 * The RPC add_house_expense_v2 re-validates everything server-side; the
 * frontend validation here is for UX feedback only.
 *
 * RPC called:
 *   add_house_expense_v2(
 *     input_house_id   uuid,
 *     input_title      text,
 *     input_amount     numeric,
 *     input_category   text,
 *     input_date       date,
 *     input_paid_by    uuid,
 *     input_split_method text,
 *     participant_ids  uuid[],
 *     split_values     numeric[]   -- null for "equal"
 *   )
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/app/lib/supabase";
import { toPaise, fromPaise, equalSplitPaise, shareSplitPaise, percentSplitPaise } from "@/app/lib/split";
import "./smart-split.css";

// ---------------------------------------------------------------------------
// Types (local — mirrors page.tsx HouseMember without the import)
// ---------------------------------------------------------------------------
export type SplitMember = {
  id: string;
  name: string;
  active: boolean;
};

// An existing expense being edited. When present the sheet switches to edit
// mode: fields prefill from it, submit calls update_house_expense_v2, and a
// delete action appears. Because the stored splits only record amounts (not the
// original method), edit mode defaults to "exact" with each share prefilled —
// always faithful to the saved split regardless of how it was first entered.
export type EditingExpense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  expense_date: string;
  paid_by: string;
  splits: { member_id: string; amount: number }[];
};

export interface HouseSmartSplitProps {
  houseId: string;
  members: SplitMember[];       // only active members should be passed
  myMemberId: string;
  onClose: () => void;
  onSaved: () => void;
  flash: (msg: string) => void;
  editing?: EditingExpense;     // present → edit mode
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CATEGORIES = ["Food", "Rent", "Bills", "Transport", "Groceries", "Utilities", "Entertainment", "Other"];
const todayStr = () => new Date().toISOString().slice(0, 10);

type SplitMode = "equal" | "exact" | "percentage" | "shares";

// Paise split helpers live in app/lib/split.ts — shared with the unit tests
// (split.test.ts) and mirrored server-side by the add_house_expense_v2 RPC.

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function HouseSmartSplit({
  houseId,
  members,
  myMemberId,
  onClose,
  onSaved,
  flash,
  editing,
}: HouseSmartSplitProps) {
  const isEdit = !!editing;
  // Original participant ids that are still active members (inactive ones can't
  // be represented — the RPC requires active participants — so they drop out
  // and the user re-picks if needed).
  const editingSelected = useMemo(() => {
    if (!editing) return null;
    const active = new Set(members.map((m) => m.id));
    const kept = editing.splits.map((s) => s.member_id).filter((id) => active.has(id));
    return kept.length > 0 ? new Set(kept) : new Set(members.map((m) => m.id));
  }, [editing, members]);

  // ── Basic expense fields ──────────────────────────────────────────────────
  const [title,    setTitle]    = useState(editing?.title ?? "");
  const [amount,   setAmount]   = useState(editing ? String(editing.amount) : "");
  const [category, setCategory] = useState(editing?.category ?? "Food");
  const [date,     setDate]     = useState(editing?.expense_date ?? todayStr());
  const [paidBy,   setPaidBy]   = useState(
    editing && members.some((m) => m.id === editing.paid_by) ? editing.paid_by : myMemberId,
  );

  // ── Split configuration ───────────────────────────────────────────────────
  // Edit mode defaults to "exact" so the saved per-member amounts round-trip.
  const [mode,         setMode]         = useState<SplitMode>(isEdit ? "exact" : "equal");
  // Selected participant IDs (start: all active members, or the edited expense's)
  const [selected,     setSelected]     = useState<Set<string>>(
    () => editingSelected ?? new Set(members.map((m) => m.id)),
  );
  // User-entered values for exact/percentage/shares modes (keyed by member id).
  // In edit mode we prefill the saved amounts so "exact" mode shows them.
  const [inputValues,  setInputValues]  = useState<Record<string, string>>(() => {
    if (!editing) return {};
    const vals: Record<string, string> = {};
    editing.splits.forEach((s) => { vals[s.member_id] = String(s.amount); });
    return vals;
  });

  // ── Saving / deleting state ────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset inputValues when the split mode changes — but NOT on the initial
  // render, so edit-mode prefilled "exact" values survive mount.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValues({});
  }, [mode]);

  // ── Derived: ordered selected members ────────────────────────────────────
  const selectedMembers = useMemo(
    () => members.filter((m) => selected.has(m.id)),
    [members, selected],
  );

  // ── Derived: allocation preview in paise ─────────────────────────────────
  const amountPaise = useMemo(() => {
    const v = parseFloat(amount);
    return isNaN(v) ? 0 : toPaise(v);
  }, [amount]);

  const allocationPaise: number[] = useMemo(() => {
    const n = selectedMembers.length;
    if (n === 0 || amountPaise <= 0) return [];

    if (mode === "equal") {
      return equalSplitPaise(amountPaise, n);
    }

    if (mode === "exact") {
      return selectedMembers.map((m) => {
        const v = parseFloat(inputValues[m.id] ?? "");
        return isNaN(v) ? 0 : toPaise(v);
      });
    }

    if (mode === "percentage") {
      const pcts = selectedMembers.map((m) => {
        const v = parseFloat(inputValues[m.id] ?? "");
        return isNaN(v) ? 0 : v;
      });
      return percentSplitPaise(amountPaise, pcts);
    }

    if (mode === "shares") {
      const ws = selectedMembers.map((m) => {
        const v = parseFloat(inputValues[m.id] ?? "");
        return isNaN(v) ? 0 : Math.max(0, v);
      });
      return shareSplitPaise(amountPaise, ws);
    }

    return [];
  }, [mode, selectedMembers, amountPaise, inputValues]);

  const allocatedPaise = allocationPaise.reduce((s, v) => s + v, 0);

  // ── Validation ────────────────────────────────────────────────────────────
  const errors = useMemo(() => {
    const errs: string[] = [];
    if (!title.trim()) errs.push("Enter a title.");
    if (amountPaise <= 0) errs.push("Enter a positive amount.");
    if (selectedMembers.length === 0) errs.push("Select at least one participant.");

    if (amountPaise > 0 && selectedMembers.length > 0) {
      if (mode === "exact") {
        if (allocatedPaise !== amountPaise) {
          const diff = (Math.abs(allocatedPaise - amountPaise) / 100).toFixed(2);
          errs.push(
            allocatedPaise < amountPaise
              ? `₹${diff} still unallocated.`
              : `₹${diff} over-allocated.`,
          );
        }
      }
      if (mode === "percentage") {
        const pctSum = selectedMembers.reduce((s, m) => {
          const v = parseFloat(inputValues[m.id] ?? "");
          return s + (isNaN(v) ? 0 : v);
        }, 0);
        if (Math.abs(pctSum - 100) > 0.01) {
          errs.push(`Percentages sum to ${pctSum.toFixed(1)}% — must be 100%.`);
        }
      }
      if (mode === "shares") {
        const shareSum = selectedMembers.reduce((s, m) => {
          const v = parseFloat(inputValues[m.id] ?? "");
          return s + (isNaN(v) ? 0 : v);
        }, 0);
        if (shareSum <= 0) errs.push("At least one share must be greater than zero.");
      }
    }
    return errs;
  }, [title, amountPaise, selectedMembers, mode, allocatedPaise, inputValues]);

  const canSubmit = errors.length === 0 && !saving;

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const client = getSupabaseBrowserClient();
    if (!client) { flash("Supabase is not configured."); return; }

    setSaving(true);

    // Build the split_values array to send to the RPC.
    // For "equal" we send null (DB computes it); for others we send the
    // user-entered values (not the paise-derived preview) so the DB
    // independently re-validates the client intent.
    let splitValues: number[] | null = null;

    if (mode === "exact") {
      splitValues = selectedMembers.map((m) => parseFloat(inputValues[m.id] ?? "0") || 0);
    } else if (mode === "percentage") {
      splitValues = selectedMembers.map((m) => parseFloat(inputValues[m.id] ?? "0") || 0);
    } else if (mode === "shares") {
      splitValues = selectedMembers.map((m) => parseFloat(inputValues[m.id] ?? "0") || 0);
    }

    const { error } = isEdit
      ? await client.rpc("update_house_expense_v2", {
          input_expense_id:   editing!.id,
          input_title:        title.trim(),
          input_amount:       parseFloat(amount),
          input_category:     category,
          input_date:         date,
          input_paid_by:      paidBy,
          input_split_method: mode,
          participant_ids:    selectedMembers.map((m) => m.id),
          split_values:       splitValues,
        })
      : await client.rpc("add_house_expense_v2", {
          input_house_id:    houseId,
          input_title:       title.trim(),
          input_amount:      parseFloat(amount),
          input_category:    category,
          input_date:        date,
          input_paid_by:     paidBy,
          input_split_method: mode,
          participant_ids:   selectedMembers.map((m) => m.id),
          split_values:      splitValues,
        });

    setSaving(false);

    if (error) {
      if (process.env.NODE_ENV === "development") console.error(isEdit ? "[update_house_expense_v2]" : "[add_house_expense_v2]", error);
      // Map DB error messages to friendly UX copy
      const msg =
        error.message.includes("Not a house member")       ? "You are not an active member of this house." :
        error.message.includes("creator or a house owner")  ? "Only the person who added this expense (or an owner) can change it." :
        error.message.includes("Payer is not")             ? "The selected payer is not an active member." :
        error.message.includes("participant")              ? "One or more participants are no longer active." :
        error.message.includes("must sum to the total")    ? "Split amounts don't add up to the expense total." :
        error.message.includes("Percentages must sum")     ? "Percentages must total 100%." :
        error.message.includes("share weight")             ? "At least one share weight must be greater than zero." :
        error.message.includes("positive amount")         ? "Amount must be greater than zero." :
        error.message.includes("Expense not found")        ? "That expense no longer exists." :
        isEdit ? "Couldn't save your changes. Please try again." : "Couldn't save the expense. Please try again.";
      flash(msg);
      return;
    }

    flash(isEdit ? "Expense updated." : "Expense added.");
    onSaved();
  };

  // ── Delete (edit mode only) ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!editing) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    const client = getSupabaseBrowserClient();
    if (!client) { flash("Supabase is not configured."); return; }
    setDeleting(true);
    const { error } = await client.rpc("delete_house_expense", { input_expense_id: editing.id });
    setDeleting(false);
    if (error) {
      if (process.env.NODE_ENV === "development") console.error("[delete_house_expense]", error);
      const msg = error.message.includes("creator or a house owner")
        ? "Only the person who added this expense (or an owner) can delete it."
        : error.message.includes("Expense not found")
        ? "That expense no longer exists."
        : "Couldn't delete the expense. Please try again.";
      flash(msg);
      return;
    }
    flash("Expense deleted.");
    onSaved();
  };

  // ── Participant toggle ────────────────────────────────────────────────────
  const toggleMember = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow deselecting the last participant
        if (next.size === 1) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Clear any entered value for this member
    setInputValues((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // ── Helpers for input display ─────────────────────────────────────────────
  const modeLabel: Record<SplitMode, string> = {
    equal: "Equal", exact: "Exact", percentage: "%", shares: "Shares",
  };

  const inputPlaceholder: Record<SplitMode, string> = {
    equal: "", exact: "₹0.00", percentage: "0", shares: "1",
  };

  // Allocation summary line (e.g. "₹1,333 / ₹2,000 allocated")
  const allocationLine = useMemo(() => {
    if (amountPaise <= 0 || selectedMembers.length === 0) return null;
    if (mode === "equal") return null; // always correct for equal
    const allocDisplay = (allocatedPaise / 100).toLocaleString("en-IN", {
      style: "currency", currency: "INR", maximumFractionDigits: 0,
    });
    const totalDisplay = (amountPaise / 100).toLocaleString("en-IN", {
      style: "currency", currency: "INR", maximumFractionDigits: 0,
    });
    const ok = allocatedPaise === amountPaise;
    return { text: `${allocDisplay} / ${totalDisplay} allocated`, ok };
  }, [mode, allocatedPaise, amountPaise, selectedMembers.length]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section
        className="sheet ss-sheet"
        onMouseDown={(ev) => ev.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit expense" : "Add expense"}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2>{isEdit ? "Edit expense" : "Add expense"}</h2>
          <button type="button" onClick={onClose} aria-label="Close">×</button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} noValidate>
          {/* ── Basic fields ── */}
          <label className="ss-label">
            What was it?
            <input
              className="ss-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Dinner"
              autoFocus
              required
            />
          </label>

          <div className="ss-row">
            <label className="ss-label ss-grow">
              Amount (₹)
              <input
                className="ss-input"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
            <label className="ss-label">
              Category
              <select
                className="ss-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>

          <div className="ss-row">
            <label className="ss-label ss-grow">
              Paid by
              <select
                className="ss-input"
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
              >
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="ss-label">
              Date
              <input
                className="ss-input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          </div>

          {/* ── Participants ── */}
          <div className="ss-section-title">Split between</div>
          <div className="ss-participants">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`ss-participant${selected.has(m.id) ? " ss-participant--on" : ""}`}
                onClick={() => toggleMember(m.id)}
                aria-pressed={selected.has(m.id)}
              >
                <span className="ss-participant-avatar">{m.name[0]?.toUpperCase()}</span>
                <span className="ss-participant-name">{m.name.split(" ")[0]}</span>
                {selected.has(m.id) && <span className="ss-participant-check" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>

          {/* ── Split mode tabs ── */}
          <div className="ss-section-title">Split method</div>
          <div className="ss-mode-tabs" role="group" aria-label="Split method">
            {(["equal", "exact", "percentage", "shares"] as SplitMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`ss-mode-tab${mode === m ? " ss-mode-tab--active" : ""}`}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
              >
                {modeLabel[m]}
              </button>
            ))}
          </div>

          {/* ── Allocation rows ── */}
          <div className="ss-allocation">
            {selectedMembers.map((m, idx) => {
              const paise = allocationPaise[idx] ?? 0;
              return (
                <div className="ss-alloc-row" key={m.id}>
                  <div className="ss-alloc-avatar">{m.name[0]?.toUpperCase()}</div>
                  <span className="ss-alloc-name">{m.name}</span>

                  {mode === "equal" ? (
                    <span className="ss-alloc-amount">
                      ₹{fromPaise(paise)}
                    </span>
                  ) : (
                    <>
                      {/* Editable input for exact/percentage/shares */}
                      <input
                        className="ss-alloc-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step={mode === "shares" ? "1" : "0.01"}
                        placeholder={inputPlaceholder[mode]}
                        value={inputValues[m.id] ?? ""}
                        onChange={(ev) => {
                          const val = ev.target.value;
                          setInputValues((prev) => ({ ...prev, [m.id]: val }));
                        }}
                        aria-label={`${m.name} ${mode === "percentage" ? "percentage" : mode === "shares" ? "shares" : "amount"}`}
                      />
                      {/* Derived amount preview */}
                      {(mode === "percentage" || mode === "shares") && paise > 0 && (
                        <span className="ss-alloc-preview">₹{fromPaise(paise)}</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {/* Allocation summary */}
            {allocationLine && (
              <div className={`ss-alloc-summary${allocationLine.ok ? " ss-alloc-summary--ok" : " ss-alloc-summary--err"}`}>
                {allocationLine.text}
              </div>
            )}

            {/* Mode hint line */}
            {mode === "equal" && amountPaise > 0 && selectedMembers.length > 0 && (
              <div className="ss-alloc-summary ss-alloc-summary--ok">
                ₹{(amountPaise / 100).toFixed(2)} / ₹{(amountPaise / 100).toFixed(2)} allocated
              </div>
            )}
          </div>

          {/* ── Submit ── */}
          <button
            className="sheet-submit"
            type="submit"
            disabled={!canSubmit}
            style={{ marginTop: 16 }}
          >
            {saving ? "Saving…" : isEdit ? "Save changes" : "Add expense"}
          </button>

          {/* ── Delete (edit mode only) — two-tap confirm ── */}
          {isEdit && (
            <button
              className="sheet-delete"
              type="button"
              onClick={() => { void handleDelete(); }}
              disabled={deleting || saving}
              aria-label={confirmDelete ? "Confirm delete expense" : "Delete expense"}
            >
              {deleting ? "Deleting…" : confirmDelete ? "Tap again to delete" : "Delete expense"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
