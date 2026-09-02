import { EventEmitter } from "node:events";

import { InMemoryJobQueue } from "@eia/domain";
import { describe, expect, it } from "vitest";

import { WorkerProcess, type WorkerLogger } from "../src/process";

function logger(): WorkerLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (_o, msg) => void lines.push(`info:${msg}`),
    warn: (_o, msg) => void lines.push(`warn:${msg}`),
    error: (_o, msg) => void lines.push(`error:${msg}`),
  };
}

function build(overrides: Partial<ConstructorParameters<typeof WorkerProcess>[0]> = {}) {
  const log = logger();
  const signals = new EventEmitter();
  const worker = new WorkerProcess({
    logger: log,
    queue: new InMemoryJobQueue(),
    healthPort: 0,
    heartbeatMs: 50,
    shutdownTimeoutMs: 500,
    signals,
    version: "test",
    ...overrides,
  });
  return { worker, log, signals };
}

describe("WorkerProcess lifecycle", () => {
  it("starts, serves /health and stops cleanly", async () => {
    const { worker, log } = build();
    await worker.start();
    expect(worker.getState()).toBe("running");
    const port = worker.getHealthPort();
    expect(port).toBeTypeOf("number");
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", service: "worker", version: "test" });
    await worker.stop("test");
    expect(worker.getState()).toBe("stopped");
    expect(log.lines).toContain("info:worker starting");
    expect(log.lines).toContain("info:worker stopped");
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it("shuts down on SIGTERM and runs stop hooks once", async () => {
    let hookRuns = 0;
    const { worker, signals } = build({
      onStop: [{ name: "hook", run: async () => void hookRuns++ }],
    });
    await worker.start();
    signals.emit("SIGTERM");
    signals.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 50));
    await worker.stop("again");
    expect(worker.getState()).toBe("stopped");
    expect(hookRuns).toBe(1);
  });

  it("fails to start when a readiness check fails", async () => {
    const { worker } = build({
      checks: [
        {
          name: "db",
          run: async () => {
            throw new Error("no db");
          },
        },
      ],
    });
    await expect(worker.start()).rejects.toThrow("no db");
    expect(worker.getState()).toBe("starting");
  });

  it("forces shutdown after the timeout when a hook hangs", async () => {
    const { worker, log } = build({
      shutdownTimeoutMs: 100,
      onStop: [{ name: "slow", run: () => new Promise(() => {}) }],
    });
    await worker.start();
    await worker.stop("hang");
    expect(worker.getState()).toBe("stopped");
    expect(log.lines).toContain("warn:graceful shutdown timed out; forcing");
  });
});
