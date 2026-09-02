import { createServer, type Server } from "node:http";
import type { EventEmitter } from "node:events";

import type { JobQueuePort } from "@eia/domain";

export interface WorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface WorkerProcessOptions {
  readonly logger: WorkerLogger;
  readonly queue: JobQueuePort;
  readonly healthPort: number;
  readonly heartbeatMs: number;
  readonly shutdownTimeoutMs: number;
  /** Optional readiness checks run at start (e.g. database connectivity as the runtime role). */
  readonly checks?: ReadonlyArray<{ name: string; run: () => Promise<void> }>;
  /** Hooks executed during stop, in order (e.g. close pools). */
  readonly onStop?: ReadonlyArray<{ name: string; run: () => Promise<void> }>;
  /** Where SIGTERM/SIGINT come from; defaults to `process` (injectable for tests). */
  readonly signals?: EventEmitter;
  readonly version?: string;
}

export type WorkerState = "created" | "starting" | "running" | "stopping" | "stopped";

/**
 * Persistent worker lifecycle (ADR-012): start → health server + heartbeat → stop on
 * SIGTERM/SIGINT (drain queue, run stop hooks, close health server) within a timeout.
 * No jobs are processed in Slice 0; the queue port is the seam for the first real job.
 */
export class WorkerProcess {
  private state: WorkerState = "created";
  private server: Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private stopping: Promise<void> | null = null;
  private readonly signalHandler = (signal: string) => {
    void this.stop(`signal ${signal}`);
  };

  constructor(private readonly options: WorkerProcessOptions) {}

  getState(): WorkerState {
    return this.state;
  }

  /** Bound health port (useful when 0 was requested). */
  getHealthPort(): number | null {
    const address = this.server?.address();
    return address && typeof address === "object" ? address.port : null;
  }

  async start(): Promise<void> {
    if (this.state !== "created") throw new Error(`cannot start from state ${this.state}`);
    this.state = "starting";
    const { logger } = this.options;
    logger.info(
      { version: this.options.version ?? "0.0.0", healthPort: this.options.healthPort },
      "worker starting",
    );

    for (const check of this.options.checks ?? []) {
      await check.run();
      logger.info({ check: check.name }, "readiness check passed");
    }

    await this.listen();
    this.heartbeat = setInterval(() => {
      void this.options.queue.pending().then((pending) => {
        logger.info({ pending, uptimeSeconds: this.uptimeSeconds() }, "heartbeat");
      });
    }, this.options.heartbeatMs);
    this.heartbeat.unref();

    const signals = this.options.signals ?? process;
    signals.once("SIGTERM", () => this.signalHandler("SIGTERM"));
    signals.once("SIGINT", () => this.signalHandler("SIGINT"));

    this.state = "running";
    logger.info({ healthPort: this.getHealthPort() }, "worker running");
  }

  async stop(reason: string): Promise<void> {
    if (this.stopping) return this.stopping;
    if (this.state === "stopped") return;
    this.state = "stopping";
    const { logger } = this.options;
    logger.info({ reason, timeoutMs: this.options.shutdownTimeoutMs }, "worker stopping");
    this.stopping = (async () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      const work = (async () => {
        await this.options.queue.drain(this.options.shutdownTimeoutMs);
        for (const hook of this.options.onStop ?? []) {
          try {
            await hook.run();
          } catch (error) {
            logger.error(
              { hook: hook.name, error: error instanceof Error ? error.message : String(error) },
              "stop hook failed",
            );
          }
        }
        await this.closeServer();
      })();
      let timer: NodeJS.Timeout | null = null;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), this.options.shutdownTimeoutMs);
        timer.unref();
      });
      const outcome = await Promise.race([work.then(() => "done" as const), timeout]);
      if (timer) clearTimeout(timer);
      if (outcome === "timeout") {
        logger.warn({ reason }, "graceful shutdown timed out; forcing");
        await this.closeServer();
      }
      this.state = "stopped";
      logger.info({ reason, uptimeSeconds: this.uptimeSeconds() }, "worker stopped");
    })();
    return this.stopping;
  }

  private uptimeSeconds(): number {
    return Math.round((Date.now() - this.startedAt) / 1000);
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        if (req.method === "GET" && req.url === "/health") {
          const body = JSON.stringify({
            status: this.state === "running" ? "ok" : this.state,
            service: "worker",
            version: this.options.version ?? "0.0.0",
            uptimeSeconds: this.uptimeSeconds(),
          });
          res.writeHead(this.state === "running" ? 200 : 503, {
            "content-type": "application/json",
            "cache-control": "no-store",
          });
          res.end(body);
          return;
        }
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"status":"not found"}');
      });
      server.once("error", reject);
      server.listen(this.options.healthPort, () => {
        server.off("error", reject);
        this.server = server;
        resolve();
      });
    });
  }

  private closeServer(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      const server = this.server;
      this.server = null;
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
}
