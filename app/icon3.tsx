import { ImageResponse } from "next/og";

// Maskable icon (512×512) — full bleed background for Android adaptive icons.
// The logo sits within the safe zone (center 80%) so no part is clipped by
// circular/squircle masks applied by Android launchers.
export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 512, height: 512 };

export default function Icon3() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Full-bleed green — no border-radius, mask shape is applied by OS
          background: "#244c39",
        }}
      >
        {/* Logo sits within safe zone (410×410 of 512×512 = 80%) */}
        <div
          style={{
            fontSize: 260,
            fontWeight: 900,
            color: "#c5f9a9",
            fontFamily: "sans-serif",
            letterSpacing: "-0.05em",
          }}
        >
          N
        </div>
      </div>
    ),
    { ...size },
  );
}
