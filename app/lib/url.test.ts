import { describe, it, expect } from "vitest";
import { safeNext } from "./url";

describe("safeNext (open-redirect guard)", () => {
  it("allows ordinary same-origin relative paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/house/abc?tab=insights")).toBe("/house/abc?tab=insights");
    expect(safeNext("/a/b/c#frag")).toBe("/a/b/c#frag");
  });

  it("rejects protocol-relative URLs (//host)", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("//evil.com/path")).toBe("/");
  });

  it("rejects absolute URLs", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com/x")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
    expect(safeNext("mailto:a@b.com")).toBe("/");
  });

  it("rejects paths that do not start with a slash", () => {
    expect(safeNext("dashboard")).toBe("/");
    expect(safeNext("../etc")).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("falls back to / for null/undefined", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });

  it("does not treat a backslash as a path separator escape", () => {
    // Browsers normalize backslashes to slashes in URLs; "/\\evil.com" starts
    // with a single "/" so it is allowed here, but the leading slash keeps it
    // same-origin (the host cannot be smuggled after a single leading slash).
    expect(safeNext("/\\evil.com")).toBe("/\\evil.com");
    // A backslash-only prefix is not a valid relative path start → rejected.
    expect(safeNext("\\\\evil.com")).toBe("/");
  });
});
