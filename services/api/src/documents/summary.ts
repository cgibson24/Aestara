// The consultation summary PDF (Bible §5.1 "Generate summary"; ADR-0026 K3-17;
// ADR-0027). Rendered in the api with PDFKit (MIT), embedding Inter (SIL Open
// Font License, fonts/OFL.txt). It holds the record's text as written: the
// practice, the patient's name, date of birth and MRN, the consultation, its
// concerns, its final notes with their addenda and the photography captured.
// Never a draft and never an image: photos reach a patient only through a
// media release, which checks the PATIENT_APP grant [B §7.3]. Colours, sizes
// and spacing come from the design tokens (light appearance, for print).
import { readFileSync } from "node:fs";
import { tokens } from "@aestara/design-tokens";
import PDFDocument from "pdfkit";

const FONT_REGULAR = readFileSync(new URL("./fonts/Inter-Regular.ttf", import.meta.url));
const FONT_SEMIBOLD = readFileSync(new URL("./fonts/Inter-SemiBold.ttf", import.meta.url));

type TextStyle = { readonly size: number; readonly lineHeight: number; readonly weight: number };

/** Print sizes from the type scale: the screen sizes read too large on paper. */
const TYPE: Record<"title" | "heading" | "body" | "meta", TextStyle> = {
  title: tokens.typography.styles.title3,
  heading: tokens.typography.styles.headline,
  body: tokens.typography.styles.footnote,
  meta: tokens.typography.styles.caption1,
};
const INK: string = tokens.color.light.textPrimary;
const MUTED: string = tokens.color.light.textSecondary;
const RULE: string = tokens.color.light.border;
const MARGIN = tokens.space.page;

export interface SummaryNote {
  readonly author: string;
  readonly finalizedAt: Date;
  readonly body: string;
}

export interface SummaryContent {
  readonly practice: { readonly name: string; readonly timeZone: string };
  readonly patient: { readonly name: string; readonly dateOfBirth: Date; readonly mrn: string | null };
  readonly consultation: {
    readonly date: Date;
    readonly provider: string | null;
    readonly reason: string | null;
  };
  readonly concerns: readonly { readonly area: string; readonly description: string }[];
  readonly notes: readonly (SummaryNote & { readonly addenda: readonly SummaryNote[] })[];
  readonly photography: readonly {
    readonly startedAt: Date;
    readonly protocol: string;
    readonly views: readonly string[];
  }[];
  readonly versionNumber: number;
  readonly generatedAt: Date;
}

/** "UPPER_LIP" → "Upper lip". */
export function areaLabel(code: string): string {
  const words = code.toLowerCase().split("_");
  return [words[0]?.replace(/^./, (c) => c.toUpperCase()) ?? "", ...words.slice(1)].join(" ");
}

export function renderSummary(content: SummaryContent): Promise<Buffer> {
  const dateTime = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: content.practice.timeZone,
  });
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: content.practice.timeZone });
  // A date of birth is a calendar date, not an instant.
  const birthDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    font: "",
    info: { Title: "Consultation summary", Producer: "Aestara", Creator: "Aestara" },
    bufferPages: true,
  });
  doc.registerFont("regular", FONT_REGULAR);
  doc.registerFont("semibold", FONT_SEMIBOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - 2 * MARGIN;
  const style = (s: TextStyle, colour: string) =>
    doc
      .font(s.weight >= 600 ? "semibold" : "regular")
      .fontSize(s.size)
      .fillColor(colour);
  const gap = (lines: number) => doc.moveDown(lines);
  const text = (value: string, s = TYPE.body, colour = INK) =>
    style(s, colour).text(value, { width, lineGap: s.lineHeight - s.size });
  const heading = (value: string) => {
    gap(0.8);
    text(value, TYPE.heading);
    const y = doc.y + tokens.space.xs;
    doc
      .moveTo(MARGIN, y)
      .lineTo(MARGIN + width, y)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.y = y + tokens.space.sm;
  };
  const field = (label: string, value: string) => {
    style(TYPE.meta, MUTED).text(`${label}  `, { continued: true });
    style(TYPE.body, INK).text(value, { width });
  };

  text("Consultation summary", TYPE.title);
  text(content.practice.name, TYPE.body, MUTED);

  heading("Patient");
  field("Name", content.patient.name);
  field("Date of birth", birthDate.format(content.patient.dateOfBirth));
  field("MRN", content.patient.mrn ?? "Not recorded");

  heading("Consultation");
  field("Date", date.format(content.consultation.date));
  field("Provider", content.consultation.provider ?? "Not assigned");
  field("Reason", content.consultation.reason ?? "Not recorded");

  heading("Concerns");
  if (content.concerns.length === 0) text("None recorded.", TYPE.body, MUTED);
  for (const concern of content.concerns) {
    style(TYPE.body, INK)
      .font("semibold")
      .text(`${areaLabel(concern.area)}: `, { width, continued: true });
    style(TYPE.body, INK).text(concern.description, { width });
  }

  heading("Notes");
  if (content.notes.length === 0) text("No final notes.", TYPE.body, MUTED);
  for (const note of content.notes) {
    text(`${note.author} · ${dateTime.format(note.finalizedAt)}`, TYPE.meta, MUTED);
    text(note.body);
    for (const addendum of note.addenda) {
      gap(0.3);
      style(TYPE.meta, MUTED).text(
        `Addendum · ${addendum.author} · ${dateTime.format(addendum.finalizedAt)}`,
        {
          width: width - tokens.space.lg,
          indent: tokens.space.lg,
        },
      );
      style(TYPE.body, INK).text(addendum.body, {
        width: width - tokens.space.lg,
        indent: tokens.space.lg,
        lineGap: TYPE.body.lineHeight - TYPE.body.size,
      });
    }
    gap(0.6);
  }

  heading("Photography");
  if (content.photography.length === 0) text("No photo sessions.", TYPE.body, MUTED);
  for (const session of content.photography) {
    text(`${session.protocol} · ${dateTime.format(session.startedAt)}`, TYPE.meta, MUTED);
    text(session.views.length > 0 ? session.views.join(", ") : "No accepted photos.");
    gap(0.3);
  }

  // A footer on every page: when it was generated and which version it is.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    const footer = `Generated ${dateTime.format(content.generatedAt)} · Version ${content.versionNumber} · Page ${i + 1} of ${pages.count}`;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    style(TYPE.meta, MUTED).text(footer, MARGIN, doc.page.height - MARGIN / 2 - TYPE.meta.size, {
      width,
      align: "center",
      lineBreak: false,
    });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
