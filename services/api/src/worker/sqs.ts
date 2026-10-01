// Long-polling SQS consumer (ADR-0023 K2-06, K2-07). A message is deleted only
// after its handler succeeds; a failure leaves it for redelivery, and after
// MAX_RECEIVES deliveries SQS moves it to the queue's dead-letter queue, which
// has an alarm. Handlers are idempotent: delivery is at least once.
import { DeleteMessageCommand, ReceiveMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { Logger } from "pino";

export type MessageHandler = (body: unknown) => Promise<void>;

export class QueueConsumer {
  private running = false;
  private loop?: Promise<void>;

  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
    readonly name: string,
    private readonly handler: MessageHandler,
    private readonly logger: Logger,
    private readonly waitSeconds = 10,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  /** Receives and handles one batch; returns how many messages it handled. Used by tests too. */
  async pollOnce(waitSeconds = this.waitSeconds): Promise<number> {
    const out = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: waitSeconds,
      }),
    );
    let handled = 0;
    for (const message of out.Messages ?? []) {
      try {
        await this.handler(JSON.parse(message.Body ?? "null"));
        await this.sqs.send(
          new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
        );
        handled += 1;
      } catch (error) {
        // Identifiers only: the queue name and the message ID, never the body.
        this.logger.warn(
          { queue: this.name, messageId: message.MessageId, err: error },
          "message handling failed",
        );
      }
    }
    return handled;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.logger.error({ queue: this.name, err: error }, "queue poll failed");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}
