/**
 * Job queue boundary (ARCHITECTURE.md §6). Slice 0 has no jobs, so no queue infrastructure is
 * installed; the port fixes the contract every job must satisfy: tenant/project context in the
 * payload and idempotency by run id. pg-boss (or equivalent) implements it in the first slice
 * that ships a job.
 */
export interface JobEnvelope<TPayload = unknown> {
  readonly name: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly actor: "system" | { readonly userId: string };
  readonly payload: TPayload;
}

export interface JobQueuePort {
  enqueue(job: JobEnvelope): Promise<void>;
  /** Number of jobs accepted but not yet processed (for health reporting). */
  pending(): Promise<number>;
  /** Stop accepting jobs and finish in-flight work within the timeout. */
  drain(timeoutMs: number): Promise<void>;
}

/** Foundation adapter: accepts jobs in memory so the worker lifecycle can be exercised and tested. */
export class InMemoryJobQueue implements JobQueuePort {
  private readonly jobs: JobEnvelope[] = [];
  private draining = false;

  async enqueue(job: JobEnvelope): Promise<void> {
    if (this.draining) throw new Error("queue is draining");
    if (!job.tenantId) throw new Error("job envelope requires tenantId");
    this.jobs.push(job);
  }

  async pending(): Promise<number> {
    return this.jobs.length;
  }

  async drain(_timeoutMs: number): Promise<void> {
    this.draining = true;
    this.jobs.length = 0;
  }
}
