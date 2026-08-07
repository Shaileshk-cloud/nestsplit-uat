"use client";

/**
 * HouseNotifications
 *
 * Responsibilities:
 *   • Load the current user's notifications from Supabase on mount.
 *   • Subscribe to Realtime INSERT events on the notifications table,
 *     filtered to rows where user_id = current user's id.
 *     New rows arrive instantly without a page refresh.
 *   • Expose unreadCount so the caller (HouseApp) can drive the bell badge.
 *   • Render a bottom-sheet panel with:
 *       - date-grouped notification cards
 *       - unread/read visual state
 *       - tap card → mark read + navigate to the relevant house/screen
 *       - "Mark all read" button
 *   • Call mark_notifications_read RPC for read operations.
 *
 * No notification data is stored in localStorage. Supabase is the only
 * source of truth. The Realtime subscription is cleaned up on unmount.
 *
 * Duplicate prevention on the INSERT side lives in the DB (unique index
 * notifications_no_dupe). The frontend simply renders what it receives.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/app/lib/supabase";
import "./notifications.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  target_type: string | null;
  target_id: string | null;
  read_at: string | null;
  created_at: string;
};

export interface HouseNotificationsProps {
  /** Auth profile id of the signed-in user */
  userId: string;
  /** ID of the currently-open house — used to filter tap navigation */
  houseId: string;
  /** Called when user taps an expense notification so HouseApp can navigate */
  onNavigate: (screen: "activity" | "home") => void;
  /** Whether the panel is currently open */
  open: boolean;
  /** Close the panel */
  onClose: () => void;
  /** Parent calls this to receive the live unread count for the badge */
  onUnreadCount: (count: number) => void;
}

// ---------------------------------------------------------------------------
// Emoji icon map per notification kind
// ---------------------------------------------------------------------------
const KIND_ICON: Record<string, string> = {
  house_expense_added:  "🍽",
  settlement_recorded:  "💸",
  settlement_received:  "✅",
  payment_due_soon:     "📅",
  payment_due_today:    "⏰",
  payment_overdue:      "⚠️",
  payment_expected:     "💰",
  member_joined:        "👋",
  all_settled:          "🎉",
  recurring_due:        "📅",
  money_due:            "💸",
  // fallback
  _default:             "🔔",
};

function iconFor(kind: string): string {
  return KIND_ICON[kind] ?? KIND_ICON._default;
}

// ---------------------------------------------------------------------------
// Relative timestamp helper
// ---------------------------------------------------------------------------
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  <  1) return "just now";
  if (mins  < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days  <  7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Date group label
// ---------------------------------------------------------------------------
function dateGroupLabel(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86_400_000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function HouseNotifications({
  userId,
  houseId: _houseId, // eslint-disable-line @typescript-eslint/no-unused-vars
  onNavigate,
  open,
  onClose,
  onUnreadCount,
}: HouseNotificationsProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [marking, setMarking] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Track which IDs we already have to prevent realtime duplicating initial load
  const seenIds = useRef<Set<string>>(new Set());

  // ── Initial load ─────────────────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { data } = await client
      .from("notifications")
      .select("id,kind,title,body,target_type,target_id,read_at,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (data) {
      const rows = data as AppNotification[];
      setNotifications(rows);
      seenIds.current = new Set(rows.map((n) => n.id));
      onUnreadCount(rows.filter((n) => !n.read_at).length);
    }
  }, [userId, onUnreadCount]);

  // ── Realtime subscription ─────────────────────────────────────────────────
  // Subscribe once on mount; clean up on unmount.
  // Filter: INSERT on notifications WHERE user_id = userId.
  // This means we only receive rows that belong to this user — never
  // another user's notifications.
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadNotifications();

    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event:  "INSERT",
          schema: "public",
          table:  "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const incoming = payload.new as AppNotification;
          // Deduplicate against the initial-load set
          if (seenIds.current.has(incoming.id)) return;
          seenIds.current.add(incoming.id);
          // Prepend the new notification; the useEffect below re-derives
          // and propagates the unread count to the parent automatically.
          setNotifications((prev) => [incoming, ...prev]);
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      void client.removeChannel(channel);
      channelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]); // intentional: only re-subscribe when user changes

  // Keep unread count in sync whenever notifications state changes
  useEffect(() => {
    onUnreadCount(notifications.filter((n) => !n.read_at).length);
  }, [notifications, onUnreadCount]);

  // ── Mark a single notification read ──────────────────────────────────────
  const markRead = useCallback(async (id: string) => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    // Optimistic update first
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n),
    );
    await client.rpc("mark_notifications_read", { notification_ids: [id] });
  }, []);

  // ── Mark all read ─────────────────────────────────────────────────────────
  const markAllRead = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    if (!client || marking) return;
    setMarking(true);
    // Optimistic
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => n.read_at ? n : { ...n, read_at: now }),
    );
    await client.rpc("mark_notifications_read", { notification_ids: null });
    setMarking(false);
  }, [marking]);

  // ── Handle card tap ───────────────────────────────────────────────────────
  const handleTap = useCallback(async (n: AppNotification) => {
    if (!n.read_at) await markRead(n.id);
    // Navigate based on kind
    if (
      n.kind === "house_expense_added" ||
      n.kind === "settlement_recorded"  ||
      n.kind === "settlement_received"
    ) {
      onNavigate("activity");
    } else {
      onNavigate("home");
    }
    onClose();
  }, [markRead, onNavigate, onClose]);

  // ── Group notifications by date ───────────────────────────────────────────
  type Group = { label: string; items: AppNotification[] };
  const groups: Group[] = [];
  notifications.forEach((n) => {
    const label = dateGroupLabel(n.created_at);
    const last  = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(n);
    } else {
      groups.push({ label, items: [n] });
    }
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  // ── Render nothing when panel is closed ───────────────────────────────────
  if (!open) return null;

  return (
    <div
      className="np-backdrop"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div
        className="np-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="np-handle" />

        {/* Header */}
        <div className="np-head">
          <h2>Notifications</h2>
          <div className="np-head-actions">
            {unreadCount > 0 && (
              <button
                className="np-mark-all"
                onClick={() => void markAllRead()}
                disabled={marking}
              >
                Mark all read
              </button>
            )}
            <button className="np-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        {/* List */}
        <div className="np-list" role="list">
          {notifications.length === 0 ? (
            <div className="np-empty">
              <div className="np-empty-icon">🔔</div>
              <p className="np-empty-title">All caught up</p>
              <p className="np-empty-body">
                Notifications from your houses will appear here.
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <p className="np-date-label">{group.label}</p>
                {group.items.map((n) => (
                  <button
                    key={n.id}
                    className={`np-card${n.read_at ? "" : " np-card--unread"}`}
                    onClick={() => void handleTap(n)}
                    role="listitem"
                    aria-label={n.body}
                  >
                    {!n.read_at && <span className="np-unread-dot" aria-hidden="true" />}
                    <div className="np-icon" aria-hidden="true">
                      {iconFor(n.kind)}
                    </div>
                    <div className="np-body">
                      <span className="np-title">{n.title}</span>
                      <span className="np-text">{n.body}</span>
                      <span className="np-time">{relativeTime(n.created_at)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
