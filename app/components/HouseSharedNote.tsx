"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/app/lib/supabase";
import "./shared-note.css";

type SharedNote = { house_id: string; content: string; updated_at: string };

function updatedLabel(timestamp: string | null) {
  if (!timestamp) return "Start a note for your house";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Saved";
  return `Updated ${date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`;
}

export default function HouseSharedNote({ houseId, userId }: { houseId: string; userId: string }) {
  const [content, setContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const contentRef = useRef("");

  const save = useCallback(async () => {
    if (!dirty.current) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setSaving(true);
    setError("");
    const { data, error: saveError } = await client
      .from("house_shared_notes")
      .upsert(
        { house_id: houseId, content: contentRef.current, updated_by: userId, updated_at: new Date().toISOString() },
        { onConflict: "house_id" },
      )
      .select("house_id,content,updated_at")
      .single();
    if (saveError) {
      setError("Couldn't save the note. Your changes are still here.");
    } else if (data) {
      dirty.current = false;
      setUpdatedAt((data as SharedNote).updated_at);
    }
    setSaving(false);
  }, [houseId, userId]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      queueMicrotask(() => {
        setLoading(false);
        setError("Shared notes need a Supabase connection.");
      });
      return;
    }
    const load = async () => {
      const { data, error: loadError } = await client.from("house_shared_notes")
        .select("house_id,content,updated_at").eq("house_id", houseId).maybeSingle();
      if (loadError) setError("Couldn't load the shared note.");
      if (data) {
        const note = data as SharedNote;
        contentRef.current = note.content;
        setContent(note.content);
        setUpdatedAt(note.updated_at);
      }
      setLoading(false);
    };
    void load();
    const channel = client.channel(`house-note:${houseId}`).on(
      "postgres_changes",
      { event: "*", schema: "public", table: "house_shared_notes", filter: `house_id=eq.${houseId}` },
      (payload) => {
        const incoming = payload.new as SharedNote;
        if (!incoming?.house_id || dirty.current) return;
        contentRef.current = incoming.content;
        setContent(incoming.content);
        setUpdatedAt(incoming.updated_at);
      },
    ).subscribe();
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void save();
      void client.removeChannel(channel);
    };
  }, [houseId, save]);

  const handleChange = (next: string) => {
    contentRef.current = next;
    dirty.current = true;
    setContent(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), 700);
  };

  return <section className="shared-note" aria-busy={loading}>
    <div className="shared-note-head">
      <div><p>HOUSE NOTE</p><h2>Shared notes</h2></div>
      <span className={saving ? "shared-note-status saving" : "shared-note-status"}>{saving ? "Saving..." : updatedLabel(updatedAt)}</span>
    </div>
    <textarea value={content} onChange={(event) => handleChange(event.target.value)} onBlur={() => void save()}
      placeholder="Groceries, chores, plans - keep the household on the same page." aria-label="Shared house note" disabled={loading} />
    {error && <p className="shared-note-error" role="status">{error}</p>}
  </section>;
}
