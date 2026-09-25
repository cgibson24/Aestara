// Hard-coded, fully synthetic prototype data. No real people or patients.
// "Today" in the prototype is Friday, September 25, 2026 (US Eastern).
import type { FaceView } from "../ui/Portrait";

export const org = {
  name: "Lumen Aesthetic Partners",
  practices: ["Madison Avenue", "Greenwich"],
  activePractice: "Madison Avenue",
};

export const me = {
  name: "Dr. Mia Kim",
  initials: "MK",
  role: "Surgeon / Physician",
  credentials: "MD, Facial Plastic Surgery",
};

export type PatientStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export type PatientRow = {
  id: string;
  name: string;
  preferred?: string | undefined;
  initials: string;
  dob: string;
  age: number;
  mrn: string;
  practice: string;
  next?: string | undefined;
  status: PatientStatus;
  flag?: string | undefined;
};

export const patients: PatientRow[] = [
  {
    id: "p1",
    name: "Ana Reyes",
    preferred: "Ana",
    initials: "AR",
    dob: "Apr 12, 1988",
    age: 38,
    mrn: "A-000142",
    practice: "Madison Avenue",
    next: "Today · 10:00 AM consultation",
    status: "ACTIVE",
    flag: "In consultation",
  },
  {
    id: "p2",
    name: "Marcus Lee",
    initials: "ML",
    dob: "Jan 3, 1979",
    age: 47,
    mrn: "A-000157",
    practice: "Madison Avenue",
    next: "Today · 11:30 AM follow-up",
    status: "ACTIVE",
  },
  {
    id: "p3",
    name: "Chloe Bennett",
    initials: "CB",
    dob: "Aug 22, 1994",
    age: 32,
    mrn: "A-000163",
    practice: "Greenwich",
    next: "Mon, Sep 28 · 9:15 AM",
    status: "ACTIVE",
  },
  {
    id: "p4",
    name: "Daniel Ortiz",
    initials: "DO",
    dob: "Nov 30, 1985",
    age: 40,
    mrn: "A-000171",
    practice: "Madison Avenue",
    next: "Wed, Sep 30 · 2:00 PM",
    status: "ACTIVE",
  },
  {
    id: "p5",
    name: "Hannah Weiss",
    initials: "HW",
    dob: "Mar 9, 1991",
    age: 35,
    mrn: "A-000188",
    practice: "Greenwich",
    status: "ACTIVE",
  },
  {
    id: "p6",
    name: "Olivia Grant",
    initials: "OG",
    dob: "Jun 17, 1972",
    age: 54,
    mrn: "A-000193",
    practice: "Madison Avenue",
    next: "Thu, Oct 8 · 1:30 PM",
    status: "ACTIVE",
  },
  {
    id: "p7",
    name: "Ethan Park",
    initials: "EP",
    dob: "Feb 26, 1983",
    age: 43,
    mrn: "A-000205",
    practice: "Greenwich",
    status: "INACTIVE",
  },
  {
    id: "p8",
    name: "Sofia Rossi",
    initials: "SR",
    dob: "Oct 5, 1996",
    age: 29,
    mrn: "A-000214",
    practice: "Madison Avenue",
    next: "Tue, Oct 13 · 4:00 PM",
    status: "ACTIVE",
  },
];

export const ana = {
  ...(patients[0] as PatientRow),
  email: "ana.reyes@example.com",
  phone: "(212) 555-0148",
  concerns: ["Thin upper lip", "Lip asymmetry", "Perioral lines"],
  allergies: "Lidocaine sensitivity (mild)",
  lastVisit: "Mar 14, 2026",
};

export const profileTabs = [
  "Overview",
  "Timeline",
  "Consultations",
  "Photos",
  "Before / After",
  "AI Simulations",
  "Treatment Plans",
  "Procedures",
  "Documents",
  "Instructions",
  "Appointments",
  "Messages",
] as const;

export const mediaPermissions: {
  category: string;
  state: "GRANTED" | "DECLINED" | "NOT_REQUESTED" | "REQUESTED";
  note: string;
}[] = [
  { category: "Clinical use", state: "GRANTED", note: "Signed Mar 14, 2026" },
  { category: "Patient app", state: "GRANTED", note: "Signed Mar 14, 2026" },
  { category: "Education", state: "REQUESTED", note: "Sent today" },
  { category: "Website", state: "DECLINED", note: "Mar 14, 2026" },
  { category: "Social media", state: "NOT_REQUESTED", note: "" },
  { category: "AI training", state: "NOT_REQUESTED", note: "" },
];

export type ProtocolView = {
  key: FaceView;
  name: string;
  required: boolean;
  captured: boolean;
  score?: number | undefined;
};

export const faceProtocol: ProtocolView[] = [
  { key: "FRONT", name: "Front", required: true, captured: true, score: 0.95 },
  { key: "LEFT_45", name: "Left 45°", required: true, captured: true, score: 0.92 },
  { key: "RIGHT_45", name: "Right 45°", required: true, captured: true, score: 0.9 },
  { key: "LEFT_PROFILE", name: "Left profile", required: true, captured: false },
  { key: "RIGHT_PROFILE", name: "Right profile", required: false, captured: false },
];

export const consultationSteps = [
  { key: "reason", label: "Reason & concerns", done: true },
  { key: "history", label: "History review", done: true },
  { key: "photos", label: "Photography", done: false, current: true },
  { key: "education", label: "Education", done: false },
  { key: "visualization", label: "Visualization", done: false, optional: true },
  { key: "plans", label: "Treatment plans", done: false },
  { key: "consents", label: "Consents & instructions", done: false },
  { key: "summary", label: "Summary & release", done: false },
] as const;

export type PlanItem = { treatment: string; area: string; qty: string; price: number };
export type Plan = {
  label: string;
  title: string;
  items: PlanItem[];
  discount: number;
  recommended?: boolean | undefined;
  note: string;
};

export const plans: Plan[] = [
  {
    label: "Plan A",
    title: "Lip definition",
    items: [
      { treatment: "Hyaluronic acid lip filler", area: "Lips", qty: "1 syringe", price: 750 },
      { treatment: "Two-week review visit", area: "—", qty: "1 visit", price: 0 },
    ],
    discount: 0,
    note: "Subtle volume and border definition in a single visit.",
  },
  {
    label: "Plan B",
    title: "Lip and perioral balance",
    items: [
      { treatment: "Hyaluronic acid lip filler", area: "Lips", qty: "1 syringe", price: 750 },
      { treatment: "Hyaluronic acid chin filler", area: "Chin", qty: "1 syringe", price: 800 },
      { treatment: "Two-week review visit", area: "—", qty: "1 visit", price: 0 },
    ],
    discount: 100,
    recommended: true,
    note: "Balances lip and chin projection in profile.",
  },
  {
    label: "Plan C",
    title: "Staged approach",
    items: [
      { treatment: "Hyaluronic acid lip filler, session 1", area: "Lips", qty: "1 syringe", price: 750 },
      { treatment: "Hyaluronic acid lip filler, session 2", area: "Lips", qty: "1 syringe", price: 750 },
    ],
    discount: 150,
    note: "Two sessions four weeks apart for a gradual change.",
  },
];

export const simulation = {
  category: "Lip filler",
  region: "Lips",
  model: "Lip visualizer 1.0.0",
  version: 2,
  generatedAt: "Today · 10:42 AM",
  parameters: [
    { label: "Upper lip volume", value: 0.4 },
    { label: "Lower lip volume", value: 0.25 },
    { label: "Vermilion border definition", value: 0.3 },
    { label: "Projection", value: 0.2 },
  ],
  checks: [
    { label: "Input photo quality", result: "PASS", detail: "Lighting, focus and pose within range" },
    { label: "Identity outside the lips", result: "PASS", detail: "Similarity 0.984 (minimum 0.970)" },
    { label: "Visual artifacts", result: "PASS", detail: "None detected" },
  ],
};

export const disclaimer =
  "AI-generated visualization for consultation purposes. Actual clinical outcomes vary. This visualization is not a guarantee or prediction of medical results.";

export type Message = {
  from: "staff" | "patient";
  author: string;
  text: string;
  time: string;
  attachment?: string | undefined;
};

export const threads = [
  {
    id: "t1",
    patient: "Ana Reyes",
    initials: "AR",
    subject: "Your consultation materials",
    last: "Thank you! I'll look at the plans tonight.",
    time: "10:58 AM",
    unread: 1,
  },
  {
    id: "t2",
    patient: "Marcus Lee",
    initials: "ML",
    subject: "Follow-up photos",
    last: "Uploaded the photos you asked for.",
    time: "9:41 AM",
    unread: 0,
  },
  {
    id: "t3",
    patient: "Olivia Grant",
    initials: "OG",
    subject: "Aftercare question",
    last: "Is some swelling normal on day two?",
    time: "Yesterday",
    unread: 2,
  },
  {
    id: "t4",
    patient: "Sofia Rossi",
    initials: "SR",
    subject: "Appointment",
    last: "See you on the 13th.",
    time: "Tue",
    unread: 0,
  },
];

export const conversation: Message[] = [
  {
    from: "staff",
    author: "Jordan Alvarez, RN",
    text: "Hi Ana, thanks for coming in today. Your consultation summary, your visualization and three plan options are now in the app.",
    time: "10:51 AM",
  },
  {
    from: "staff",
    author: "Jordan Alvarez, RN",
    text: "Your aftercare guide is attached in case you choose to go ahead.",
    time: "10:52 AM",
    attachment: "Lip filler aftercare.pdf",
  },
  {
    from: "patient",
    author: "Ana Reyes",
    text: "Thank you! I'll look at the plans tonight.",
    time: "10:58 AM",
  },
];

export const patientTodos = [
  {
    icon: "signature" as const,
    title: "Sign your consent",
    detail: "Dermal filler consent · 3 minutes",
    tone: "accent" as const,
  },
  {
    icon: "clipboard" as const,
    title: "Review your treatment options",
    detail: "3 plans from Dr. Kim",
    tone: "neutral" as const,
  },
  {
    icon: "photo" as const,
    title: "Your visualization is ready",
    detail: "Released today",
    tone: "neutral" as const,
  },
];

export const staffUsers = [
  {
    name: "Dr. Mia Kim",
    email: "mia.kim@lumenaesthetic.example",
    role: "Surgeon / Physician",
    scope: "Organization",
    status: "Active",
    last: "Now",
  },
  {
    name: "Jordan Alvarez, RN",
    email: "jordan.alvarez@lumenaesthetic.example",
    role: "Nurse / Injector / Aesthetician",
    scope: "Madison Avenue",
    status: "Active",
    last: "4 min ago",
  },
  {
    name: "Sam Okafor",
    email: "sam.okafor@lumenaesthetic.example",
    role: "Photographer",
    scope: "Madison Avenue",
    status: "Active",
    last: "1 h ago",
  },
  {
    name: "Taylor Brooks",
    email: "taylor.brooks@lumenaesthetic.example",
    role: "Consultant",
    scope: "Greenwich",
    status: "Active",
    last: "Yesterday",
  },
  {
    name: "Priya Shah",
    email: "priya.shah@lumenaesthetic.example",
    role: "Front desk",
    scope: "Madison Avenue",
    status: "Active",
    last: "12 min ago",
  },
  {
    name: "Elena Novak",
    email: "elena.novak@lumenaesthetic.example",
    role: "Practice admin",
    scope: "Greenwich",
    status: "Active",
    last: "Mon",
  },
  {
    name: "Chris Dunn",
    email: "chris.dunn@lumenaesthetic.example",
    role: "Marketing",
    scope: "Organization",
    status: "Invited",
    last: "—",
  },
  {
    name: "Robin Hale",
    email: "robin.hale@lumenaesthetic.example",
    role: "Front desk",
    scope: "Greenwich",
    status: "Disabled",
    last: "Aug 30",
  },
];

export const rolePermissions = [
  { group: "Patients", items: ["patient.read", "patient.create", "patient.update", "patient.archive"] },
  {
    group: "Photos",
    items: ["photo.capture", "photo.view", "photo.annotate", "photo.export", "photo.permission.manage"],
  },
  { group: "Consultations", items: ["consultation.create", "consultation.edit", "consultation.complete"] },
  {
    group: "AI visualizations",
    items: ["simulation.create", "simulation.generate", "simulation.approve", "simulation.release"],
  },
  {
    group: "Plans & consents",
    items: ["treatmentplan.send", "consent.assign", "consent.sign.provider", "consent.void"],
  },
];

export const auditRows = [
  {
    time: "10:58:14",
    actor: "Ana Reyes (patient)",
    action: "MESSAGE_SENT",
    resource: "Message",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "10:55:02",
    actor: "Dr. Mia Kim",
    action: "SIMULATION_RELEASED",
    resource: "Simulation",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "10:54:40",
    actor: "Dr. Mia Kim",
    action: "SIMULATION_APPROVED",
    resource: "Simulation",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "10:42:07",
    actor: "ai-gateway (service)",
    action: "SIMULATION_STATUS_CHANGED",
    resource: "Simulation",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "10:31:55",
    actor: "Sam Okafor",
    action: "PHOTO_CAPTURED",
    resource: "Patient photo",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "10:12:19",
    actor: "Taylor Brooks",
    action: "PHOTO_EXPORTED",
    resource: "Before/after set",
    patient: "A-000171",
    outcome: "DENIED",
  },
  {
    time: "10:05:33",
    actor: "Dr. Mia Kim",
    action: "PATIENT_VIEWED",
    resource: "Patient",
    patient: "A-000142",
    outcome: "SUCCESS",
  },
  {
    time: "09:58:01",
    actor: "Unknown",
    action: "LOGIN_FAILURE",
    resource: "Session",
    patient: "—",
    outcome: "FAILURE",
  },
  {
    time: "09:12:44",
    actor: "Elena Novak",
    action: "ROLE_ASSIGNED",
    resource: "User role",
    patient: "—",
    outcome: "SUCCESS",
  },
];

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
