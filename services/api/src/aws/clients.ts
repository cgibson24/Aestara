// AWS clients for the api and the worker (spec §2.1; ADR-0023 K2-08, K2-09).
// In AWS they use the task role from the default credential chain; locally they
// point at the moto emulator. Devices receive URLs signed by a separate
// presigning role when one is configured, so the service roles themselves can
// stay limited to the VPC endpoint.
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { CONFIG, type Config } from "../config.ts";

type AwsConfig = Pick<
  Config,
  "AWS_REGION" | "AWS_ENDPOINT_URL" | "S3_FORCE_PATH_STYLE" | "S3_PRESIGN_ROLE_ARN"
>;

function common(config: AwsConfig) {
  return {
    region: config.AWS_REGION,
    // The emulator accepts any credentials; deployed environments use the task role.
    ...(config.AWS_ENDPOINT_URL !== undefined
      ? { endpoint: config.AWS_ENDPOINT_URL, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  };
}

@Injectable()
export class AwsClients implements OnModuleDestroy {
  /** S3 for the service's own reads and writes (VPC endpoint in AWS). */
  readonly s3: S3Client;
  /** S3 for URLs handed to devices and to the image-processing service. */
  readonly presigner: S3Client;
  private sqsClient?: SQSClient;
  private eventsClient?: EventBridgeClient;

  constructor(@Inject(CONFIG) private readonly config: AwsConfig) {
    this.s3 = new S3Client({ ...common(config), forcePathStyle: config.S3_FORCE_PATH_STYLE });
    this.presigner =
      config.S3_PRESIGN_ROLE_ARN === undefined
        ? this.s3
        : new S3Client({
            ...common(config),
            forcePathStyle: config.S3_FORCE_PATH_STYLE,
            credentials: fromTemporaryCredentials({
              params: {
                RoleArn: config.S3_PRESIGN_ROLE_ARN,
                RoleSessionName: "aestara-presign",
                DurationSeconds: 3600,
              },
              clientConfig: { region: config.AWS_REGION },
            }),
          });
  }

  get sqs(): SQSClient {
    this.sqsClient ??= new SQSClient(common(this.config));
    return this.sqsClient;
  }

  get events(): EventBridgeClient {
    this.eventsClient ??= new EventBridgeClient(common(this.config));
    return this.eventsClient;
  }

  onModuleDestroy(): void {
    this.s3.destroy();
    if (this.presigner !== this.s3) this.presigner.destroy();
    this.sqsClient?.destroy();
    this.eventsClient?.destroy();
  }
}
