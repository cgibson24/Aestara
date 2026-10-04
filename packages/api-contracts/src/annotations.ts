// Photo annotations (spec §6.3 "Photography"; Bible §5.1 "Annotate if needed",
// §6.6, §23.1; ADR-0026 K3-10). A layer is versioned vector JSON drawn over the
// photo; it never touches the original and reaches pixels only in an export.
// There are no measurement tools: no lengths, areas or angles.
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

/** The annotation palette; the colours themselves are design tokens (tokens.json "annotation"). */
export const ANNOTATION_COLORS = ["RED", "YELLOW", "GREEN", "BLUE", "WHITE", "BLACK"] as const;
export const AnnotationColor = z.enum(ANNOTATION_COLORS).meta({ id: "AnnotationColor" });

/** Stroke widths as a fraction of the photo's height, so a layer draws the same at any size. */
export const ANNOTATION_STROKE_WIDTHS = { THIN: 0.002, MEDIUM: 0.004, THICK: 0.008 } as const;
export const AnnotationStroke = z.enum(["THIN", "MEDIUM", "THICK"]).meta({ id: "AnnotationStroke" });

/** Text sizes as a fraction of the photo's height. */
export const ANNOTATION_TEXT_SIZES = { SMALL: 0.02, MEDIUM: 0.03, LARGE: 0.045 } as const;
export const AnnotationTextSize = z.enum(["SMALL", "MEDIUM", "LARGE"]).meta({ id: "AnnotationTextSize" });

export const ANNOTATION_MAX_SHAPES = 500;
export const ANNOTATION_MAX_BYTES = 256 * 1024;

/** A point on the upright photo: x and y from 0 (left, top) to 1 (right, bottom). */
export const AnnotationPoint = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
  .meta({ id: "AnnotationPoint" });

const Stroke = { color: AnnotationColor, stroke: AnnotationStroke };

export const AnnotationShape = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("FREEHAND"),
      points: z.array(AnnotationPoint).min(2).max(2000),
      ...Stroke,
    }),
    z.strictObject({ type: z.literal("LINE"), from: AnnotationPoint, to: AnnotationPoint, ...Stroke }),
    z.strictObject({ type: z.literal("ARROW"), from: AnnotationPoint, to: AnnotationPoint, ...Stroke }),
    z.strictObject({
      type: z.literal("ELLIPSE"),
      center: AnnotationPoint,
      radiusX: z.number().min(0).max(1),
      radiusY: z.number().min(0).max(1),
      ...Stroke,
    }),
    z.strictObject({
      type: z.literal("RECTANGLE"),
      origin: AnnotationPoint.meta({ description: "Top-left corner." }),
      size: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
      ...Stroke,
    }),
    z.strictObject({
      type: z.literal("TEXT"),
      position: AnnotationPoint.meta({ description: "Top-left of the text." }),
      text: z.string().trim().min(1).max(200),
      color: AnnotationColor,
      size: AnnotationTextSize,
    }),
  ])
  .meta({ id: "AnnotationShape" });

export const AnnotationLayer = z
  .strictObject({
    schemaVersion: z.literal(1),
    shapes: z.array(AnnotationShape).max(ANNOTATION_MAX_SHAPES),
  })
  .refine((layer) => new TextEncoder().encode(JSON.stringify(layer)).length <= ANNOTATION_MAX_BYTES, {
    message: "An annotation layer may hold at most 256 KiB.",
  })
  .meta({
    id: "AnnotationLayer",
    description: "Version 1: shapes in coordinates normalized to the upright photo. No measurements.",
  });

export const PhotoAnnotation = z
  .strictObject({
    id: Uuid,
    photoId: Uuid,
    authorUserId: Uuid,
    label: z.string().optional(),
    layer: AnnotationLayer,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "PhotoAnnotation" });

const Label = z.string().trim().min(1).max(80);

export const PhotoAnnotationCreate = z
  .strictObject({
    id: z
      .uuid({ version: "v7" })
      .optional()
      .meta({ description: "Client-generated UUIDv7 for a layer drawn offline." }),
    label: Label.optional(),
    layer: AnnotationLayer,
  })
  .meta({ id: "PhotoAnnotationCreate" });

export const PhotoAnnotationUpdate = z
  .strictObject({ label: Label.nullable().optional(), layer: AnnotationLayer.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field." })
  .meta({ id: "PhotoAnnotationUpdate", description: "Only the author changes a layer." });
