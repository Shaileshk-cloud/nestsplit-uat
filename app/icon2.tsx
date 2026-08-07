import { ImageResponse } from "next/og";

// NestSplit large icon (512×512) — for PWA splash screens and install sheets
export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 512, height: 512 };

export default function Icon2() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#244c39",
          borderRadius: "108px",
        }}
      >
        <div
          style={{
            fontSize: 320,
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
