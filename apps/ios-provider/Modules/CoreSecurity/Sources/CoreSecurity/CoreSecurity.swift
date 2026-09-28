// CoreSecurity
//
// Keychain access, the encrypted local store (GRDB + SQLCipher), biometric gate, secure wipe on sign-out.
// Bible §21.2, §23.3 · tier: foundation · built from Layer 1.
//
// Layer 0 defines this module's boundary and allowed dependencies only
// (modules.json, docs/IOS_ARCHITECTURE.md). Its code arrives in the layer named
// above; nothing may fake behaviour before then (Bible §30).
