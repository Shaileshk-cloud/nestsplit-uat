import { ImageResponse } from "next/og";

// NestSplit app icon — generates PNG at build time
export const runtime = "nodejs";
export const contentType = "image/png";
export const size = { width: 192, height: 192 };

export default function Icon() {
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
          borderRadius: "40px",
        }}
      >
        <div
          style={{
            fontSize: 120,
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
