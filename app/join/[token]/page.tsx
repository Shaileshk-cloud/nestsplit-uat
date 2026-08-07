"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient, signInWithGoogle } from "@/app/lib/supabase";

export default function JoinHousePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [message, setMessage] = useState("Checking your invitation…");
  const [ready, setReady] = useState(false);
  const token = params.token;

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) { void Promise.resolve().then(() => setMessage("Supabase is not configured.")); return; }
    client.auth.getUser().then(({ data }) => { if (data.user) setReady(true); else setMessage("Sign in to join this house."); });
  }, []);

  const join = async () => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    setMessage("Joining house…");
    const { data, error } = await client.rpc("join_house_by_invite", { input_token: token });
    if (error) { setMessage(error.message); return; }
    const { data: auth } = await client.auth.getUser();
    if (auth.user && data) window.localStorage.setItem(`nestsplit:last-workspace:${auth.user.id}`, `house:${data.id}`);
    router.replace("/");
  };

  return <main className="app-stage"><section className="phone-shell auth-shell"><div className="logo">N</div><div className="auth-copy"><p className="eyebrow">HOUSE INVITATION</p><h1>Join your home.</h1><p>{message}</p></div>{ready ? <button onClick={join}>Join house</button> : <button onClick={() => signInWithGoogle(`/join/${token}`)}>Continue with Google</button>}</section></main>;
}
