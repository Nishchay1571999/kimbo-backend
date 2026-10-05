import type { Response } from 'express';
import type { ChatEvent } from '../domain/chat.types.js';
export class ChatStreamWriter {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly response: Response) {
    response.status(200);
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }
  emit = (event: ChatEvent): Promise<void> => {
    this.pending = this.pending.then(async () => {
      if (this.response.destroyed || this.response.writableEnded) return;
      if (!this.response.write(`${JSON.stringify(event)}\n`))
        await new Promise<void>((resolve) => {
          const done = () => {
            this.response.off('drain', done);
            this.response.off('close', done);
            this.response.off('error', done);
            resolve();
          };
          this.response.once('drain', done);
          this.response.once('close', done);
          this.response.once('error', done);
        });
    });
    return this.pending;
  };
  async end() {
    await this.pending;
    if (!this.response.destroyed && !this.response.writableEnded)
      this.response.end();
  }
}
