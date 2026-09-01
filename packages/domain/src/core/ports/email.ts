/** Email boundary. Slice 0 ships console and no-op adapters; no provider is selected. */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export class ConsoleEmailAdapter implements EmailPort {
  constructor(private readonly logger: EmailLogger) {}
  async send(message: EmailMessage): Promise<void> {
    // Body is intentionally not logged in full (it may carry links/tokens); subject + recipient domain only.
    const domain = message.to.split("@")[1] ?? "unknown";
    this.logger.info({ toDomain: domain, subject: message.subject }, "email (console adapter)");
  }
}

export class NoopEmailAdapter implements EmailPort {
  async send(_message: EmailMessage): Promise<void> {
    /* intentionally empty */
  }
}
