import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errorText, execSimctl } from "../simctl";

describe("execSimctl", () => {
  let directory = "";
  let originalPath: string | undefined;

  beforeAll(() => {
    // A fake `xcrun` on PATH: `simctl stall` never returns, like a call to an
    // unresponsive CoreSimulatorService; `simctl fail` exits non-zero.
    directory = mkdtempSync(join(tmpdir(), "hub-simctl-"));
    const xcrun = join(directory, "xcrun");
    writeFileSync(
      xcrun,
      [
        "#!/bin/sh",
        'case "$2" in',
        `  stall) echo $$ > "${join(directory, "stalled.pid")}"; exec sleep 60 ;;`,
        '  fail) echo "Unable to boot device in current state: Booted" >&2; exit 1 ;;',
        '  *) echo "ok" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(xcrun, 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${directory}:${originalPath ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    rmSync(directory, { recursive: true, force: true });
  });

  test("ends a simctl call that never returns with a timeout error", async () => {
    const started = Date.now();
    const executed = await execSimctl(["stall"], { timeoutMs: 150 });

    expect(executed.value).toBeNull();
    expect(executed.error?.message).toBe(
      "[apple-utils] `xcrun simctl stall` did not respond within 0.15 s; CoreSimulatorService may need restarting",
    );
    expect(Date.now() - started).toBeLessThan(5000);

    const pid = Number(readFileSync(join(directory, "stalled.pid"), "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("does not let ignoreError hide a timeout", async () => {
    const executed = await execSimctl(["stall"], { timeoutMs: 150, ignoreError: () => true });

    expect(executed.error?.message).toContain("did not respond within 0.15 s");
  });

  test("reports an ordinary failure with the failure message", async () => {
    const executed = await execSimctl(["fail"], { timeoutMs: 5000 });

    expect(executed.value).toBeNull();
    expect(executed.error?.message).toBe("[apple-utils] Failed to run `xcrun simctl fail`:");
  });

  test("still lets ignoreError accept a benign failure", async () => {
    const executed = await execSimctl(["fail"], {
      ignoreError: (error) => errorText(error).includes("current state: Booted"),
    });

    expect(executed).toEqual({ value: null, error: null });
  });
});
