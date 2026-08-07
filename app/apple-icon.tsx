import { ImageResponse } from "next/og";

// Apple touch icon — generates PNG at build time
export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 180, height: 180 };

export default function AppleIcon() {
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
        }}
      >
        <div
          style={{
            fontSize: 110,
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
