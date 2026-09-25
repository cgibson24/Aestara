# Provider iOS/iPadOS app

SwiftUI app for surgeons, injectors, nurses, photographers, consultants and front desk (Bible §2, §24). iPad landscape first, full iPhone support, iOS/iPadOS 26+ (ADR-0005).

**Status:** placeholder. No code yet, by design: the Bible forbids fake business implementations (§0.1, §31).

**Built in:** Tuist project skeleton in Step 3 (Layer 0 completion); shell, login and patients in Layer 1 (M1.9–M1.10).

Modules follow Bible §24.4: AppShell, Authentication, CoreNetworking, CoreSecurity, DesignSystem, PatientDomain, ConsultationDomain, Photography, Media, Annotations, BeforeAfter, Simulation, TreatmentPlans, DocumentsConsent, Education, Appointments, Messaging, Telehealth, Settings, AuditSupport. Colours/spacing/type come from `packages/design-tokens/generated/DesignTokens.swift`.

Roadmap: `docs/DEVELOPMENT_ROADMAP.md`.
