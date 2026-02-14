import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/utils/secret-redactor.js";

describe("redactSecrets", () => {
  it("redacts AWS access keys", () => {
    const result = redactSecrets("key: AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[REDACTED:AWS_ACCESS_KEY]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts GitHub PATs", () => {
    const result = redactSecrets("token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12345");
    expect(result).toContain("[REDACTED:GITHUB_PAT]");
  });

  it("redacts private key headers", () => {
    const result = redactSecrets("-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----");
    expect(result).toContain("[REDACTED:PRIVATE_KEY]");
  });

  it("redacts password in URLs", () => {
    const result = redactSecrets("postgres://user:secretpass123@localhost:5432/db");
    expect(result).toContain("[REDACTED:PASSWORD_IN_URL]");
  });

  it("leaves clean text unchanged", () => {
    const text = "Just some normal output with no secrets";
    expect(redactSecrets(text)).toBe(text);
  });
});
