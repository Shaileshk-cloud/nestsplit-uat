import { redirect } from "next/navigation";

// Insights is a tab inside the native mobile shell. Keep legacy deep links valid.
export default function InsightsRedirect() {
  redirect("/");
}
