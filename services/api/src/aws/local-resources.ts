// Creates the Layer 2 AWS resources on the local emulator (moto; ADR-0023
// K2-08): the media and audit-archive buckets, the event bus and its rule, the
// work queues with their dead-letter queues, and the object-created
// notifications the local scanner reads. In AWS, Terraform creates the same
// resources (infrastructure/terraform/modules/storage and modules/messaging).
// Used by the api tests and the local stack only; refuses a non-local endpoint.
import {
  CreateEventBusCommand,
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  CreateBucketCommand,
  PutBucketNotificationConfigurationCommand,
  PutBucketVersioningCommand,
  PutObjectLockConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { CreateQueueCommand, GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";

export interface LocalAwsResources {
  readonly endpoint: string;
  readonly mediaBucket: string;
  readonly auditArchiveBucket: string;
  readonly eventBusName: string;
  readonly queues: {
    readonly workerEvents: string;
    readonly imageJobs: string;
    readonly imageResults: string;
    readonly scanResults: string;
    readonly scanRequests: string;
  };
}

/** The environment variables that point the api, the worker and image-processing at these resources. */
export function awsEnv(r: LocalAwsResources): Record<string, string> {
  return {
    AWS_ENDPOINT_URL: r.endpoint,
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "local",
    AWS_SECRET_ACCESS_KEY: "local",
    S3_FORCE_PATH_STYLE: "true",
    MEDIA_BUCKET: r.mediaBucket,
    AUDIT_ARCHIVE_BUCKET: r.auditArchiveBucket,
    EVENT_BUS_NAME: r.eventBusName,
    WORKER_EVENTS_QUEUE_URL: r.queues.workerEvents,
    IMAGE_JOBS_QUEUE_URL: r.queues.imageJobs,
    IMAGE_RESULTS_QUEUE_URL: r.queues.imageResults,
    SCAN_RESULTS_QUEUE_URL: r.queues.scanResults,
    SCAN_REQUESTS_QUEUE_URL: r.queues.scanRequests,
    MALWARE_SCANNER: "local",
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** Redeliveries before a message moves to its dead-letter queue (ADR-0023 K2-06). */
export const MAX_RECEIVES = 5;

/** The uploaded object classes the malware scan covers (K2-04, K3-16); Terraform's scanned_prefixes. */
const SCANNED_PREFIXES = ["CLINICAL_ORIGINAL/", "DOCUMENT/"];

/** Provisions one isolated set of resources, named with `prefix` (tests run several side by side). */
export async function provisionLocalAws(endpoint: string, prefix: string): Promise<LocalAwsResources> {
  if (!LOCAL_HOSTS.has(new URL(endpoint).hostname))
    throw new Error("Local AWS resources go on a local emulator only");
  const common = {
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  };
  const s3 = new S3Client({ ...common, forcePathStyle: true });
  const sqs = new SQSClient(common);
  const events = new EventBridgeClient(common);
  try {
    const mediaBucket = `${prefix}-clinical-media`;
    const auditArchiveBucket = `${prefix}-audit-archive`;
    await s3.send(new CreateBucketCommand({ Bucket: mediaBucket }));
    await s3.send(
      new PutBucketVersioningCommand({ Bucket: mediaBucket, VersioningConfiguration: { Status: "Enabled" } }),
    );
    // The WORM copy: Object Lock with a default retention (1 day, governance mode, as in dev).
    await s3.send(new CreateBucketCommand({ Bucket: auditArchiveBucket, ObjectLockEnabledForBucket: true }));
    await s3.send(
      new PutObjectLockConfigurationCommand({
        Bucket: auditArchiveBucket,
        ObjectLockConfiguration: {
          ObjectLockEnabled: "Enabled",
          Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 1 } },
        },
      }),
    );

    const queue = async (name: string) => {
      const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-${name}-dlq` }));
      const dlqArn = (
        await sqs.send(
          new GetQueueAttributesCommand({ QueueUrl: dlq.QueueUrl, AttributeNames: ["QueueArn"] }),
        )
      ).Attributes?.QueueArn;
      const created = await sqs.send(
        new CreateQueueCommand({
          QueueName: `${prefix}-${name}`,
          Attributes: {
            VisibilityTimeout: "60",
            RedrivePolicy: JSON.stringify({
              deadLetterTargetArn: dlqArn,
              maxReceiveCount: String(MAX_RECEIVES),
            }),
          },
        }),
      );
      const url = created.QueueUrl ?? "";
      const arn =
        (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] })))
          .Attributes?.QueueArn ?? "";
      return { url, arn };
    };
    const workerEvents = await queue("worker-events");
    const imageJobs = await queue("image-jobs");
    const imageResults = await queue("image-results");
    const scanResults = await queue("scan-results");
    const scanRequests = await queue("scan-requests");

    const eventBusName = `${prefix}-bus`;
    await events.send(new CreateEventBusCommand({ Name: eventBusName }));
    await events.send(
      new PutRuleCommand({
        Name: `${prefix}-worker-events`,
        EventBusName: eventBusName,
        EventPattern: JSON.stringify({
          source: ["aestara.api"],
          "detail-type": [
            "image.derivative.requested",
            "image.registration.requested",
            "image.export.requested",
          ],
        }),
      }),
    );
    await events.send(
      new PutTargetsCommand({
        Rule: `${prefix}-worker-events`,
        EventBusName: eventBusName,
        Targets: [{ Id: "worker", Arn: workerEvents.arn }],
      }),
    );
    // The local scanner reads what GuardDuty would scan: every uploaded original and document.
    await s3.send(
      new PutBucketNotificationConfigurationCommand({
        Bucket: mediaBucket,
        NotificationConfiguration: {
          QueueConfigurations: SCANNED_PREFIXES.map((prefix) => ({
            QueueArn: scanRequests.arn,
            Events: ["s3:ObjectCreated:*" as const],
            Filter: { Key: { FilterRules: [{ Name: "prefix" as const, Value: prefix }] } },
          })),
        },
      }),
    );
    return {
      endpoint,
      mediaBucket,
      auditArchiveBucket,
      eventBusName,
      queues: {
        workerEvents: workerEvents.url,
        imageJobs: imageJobs.url,
        imageResults: imageResults.url,
        scanResults: scanResults.url,
        scanRequests: scanRequests.url,
      },
    };
  } finally {
    s3.destroy();
    sqs.destroy();
    events.destroy();
  }
}
