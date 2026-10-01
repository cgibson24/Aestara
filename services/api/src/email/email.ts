// Transactional email (roadmap M1.3; ADR-0021 "Email links"). Messages carry
// no PHI: an invitation or reset link whose token sits in the URL fragment,
// so it never reaches a server log. Transports: SES in AWS, Mailpit locally,
// and an in-memory outbox for tests.
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONFIG, type Config } from "../config.ts";

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** Lets tests find the message; never sent. */
  readonly kind: "INVITATION" | "PASSWORD_RESET" | "PASSWORD_CHANGED" | "MFA_RESET";
}

@Injectable()
export class EmailService {
  /** The memory transport's outbox (tests and local runs without Mailpit). */
  readonly outbox: EmailMessage[] = [];
  private readonly logger = new Logger("email");
  private readonly ses: SESv2Client | undefined;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.ses = config.EMAIL_TRANSPORT === "ses" ? new SESv2Client({ region: config.AWS_REGION }) : undefined;
  }

  /** Sends without failing the request: delivery problems are logged without the address. */
  async send(message: EmailMessage): Promise<void> {
    try {
      await this.deliver(message);
    } catch (error) {
      this.logger.error(
        { kind: message.kind, err: error instanceof Error ? error.name : "unknown" },
        "email failed",
      );
    }
  }

  private async deliver(message: EmailMessage): Promise<void> {
    switch (this.config.EMAIL_TRANSPORT) {
      case "memory":
        this.outbox.push(message);
        if (this.outbox.length > 1000) this.outbox.shift();
        return;
      case "mailpit": {
        const res = await fetch(new URL("/api/v1/send", this.config.MAILPIT_URL), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: { Email: this.config.EMAIL_FROM, Name: "Aestara" },
            To: [{ Email: message.to }],
            Subject: message.subject,
            Text: message.text,
          }),
        });
        if (!res.ok) throw new Error(`Mailpit answered ${res.status}`);
        return;
      }
      case "ses":
        await this.ses?.send(
          new SendEmailCommand({
            FromEmailAddress: this.config.EMAIL_FROM,
            Destination: { ToAddresses: [message.to] },
            Content: {
              Simple: {
                Subject: { Data: message.subject, Charset: "UTF-8" },
                Body: { Text: { Data: message.text, Charset: "UTF-8" } },
              },
            },
          }),
        );
        return;
    }
  }

  /** A link into the admin web with the secret in the fragment (`#token=…`). */
  link(path: "/accept-invitation" | "/reset-password", token: string): string {
    const url = new URL(path, this.config.ADMIN_WEB_URL);
    url.hash = `token=${token}`;
    return url.toString();
  }
}

export function invitationEmail(to: string, organizationName: string, link: string): EmailMessage {
  return {
    kind: "INVITATION",
    to,
    subject: `You are invited to ${organizationName} on Aestara`,
    text:
      `You have been invited to join ${organizationName} on Aestara.\n\n` +
      `Accept the invitation within 72 hours:\n${link}\n\n` +
      "If you did not expect this, ignore this email.",
  };
}

export function passwordResetEmail(to: string, link: string): EmailMessage {
  return {
    kind: "PASSWORD_RESET",
    to,
    subject: "Reset your Aestara password",
    text:
      `Someone asked to reset the password of your Aestara account.\n\nReset it within 30 minutes:\n${link}\n\n` +
      "If this was not you, ignore this email; your password has not changed.",
  };
}

export function passwordChangedEmail(to: string): EmailMessage {
  return {
    kind: "PASSWORD_CHANGED",
    to,
    subject: "Your Aestara password was changed",
    text:
      "The password of your Aestara account was just changed, and your other sessions were signed out.\n\n" +
      "If this was not you, contact your administrator now.",
  };
}

export function mfaResetEmail(to: string): EmailMessage {
  return {
    kind: "MFA_RESET",
    to,
    subject: "Your Aestara sign-in factors were reset",
    text:
      "An administrator removed the second factors of your Aestara account and signed out its sessions.\n" +
      "You will set up a new factor the next time you sign in.\n\n" +
      "If you did not ask for this, contact your administrator now.",
  };
}
