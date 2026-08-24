# Shortcut Maker Feature Design

**Date:** 2026-08-23  
**Feature:** AI-powered iOS Shortcuts generator with iCloud signing  
**Approach:** Approach 1 (Simple direct generation)

---

## Overview

Shortcut Maker enables users to generate iOS Shortcuts via natural language description. The app uses Workers AI to convert user intent into valid iOS Shortcut plist XML, signs the shortcut using a service account Apple Developer certificate, and delivers a ready-to-install `.shortcut` file for direct iOS installation without the "Untrusted Shortcut" warning.

**User flow:** Describe what you want → AI generates → Sign → Download → Install on iOS.

---

## Purpose & Success Criteria

**Purpose:** Empower users to automate iOS tasks without learning Shortcut syntax. Extend Fayolla's scope from personal system data (habits, nutrition, finance) to general iOS automation.

**Success criteria:**
- User can describe a shortcut in natural language and receive the matching
  actions, as a `.shortcut` file plus step-by-step rebuild instructions
- ~~File installs on iOS device without trust warnings (iCloud signed)~~
  **Not achievable without a Mac** — see "Shortcut Signing & Deployment" below.
  Until a signer is configured the user rebuilds the shortcut from the steps.
- Generate time < 10 seconds for typical requests
- Error rate < 5% for valid requests (AI produces invalid plist)
- Graceful degradation: user sees actionable suggestions on failure

---

## Architecture

### Data Flow

```
User Input (description)
    ↓
[Frontend] POST /shortcuts/generate {description}
    ↓
[Backend] Validate input (length, injection patterns)
    ↓
[Workers AI] Generate Shortcut plist XML from description
    ↓
[Signing] Sign plist with service account cert
    ↓
[Response] Return signed .shortcut file (binary)
    ↓
[Frontend] Trigger browser download
    ↓
[User Device] Install shortcut on iOS
```

### Technology Stack

- **Frontend:** React, new screen at `/shortcuts`, follows Nutrition screen styling
- **Backend:** Cloudflare Workers endpoint `POST /shortcuts/generate`
- **AI Model:** Workers AI (text-to-code, same model used for nutrition label scanning)
- **Signing:** Apple signing certificate (service account, stored as env vars)
- **Data:** Stateless (no D1 persistence)

---

## Frontend Design

### Screen Layout

**Route:** `/shortcuts` (accessible from "Lainnya" hub, same navigation as Nutrition/Projects)

**Components:**
- Header: "Pembuat Shortcut" (Shortcut Maker)
- Input field:
  - Placeholder: "Deskripsi apa yang ingin Anda buat?" (e.g., "set a 10-minute timer")
  - Min 3 characters to enable Generate button
  - Max 500 characters
- Generate button: Spring motion on click, disabled during loading
- State indicators:
  - `idle`: Show input + Generate button
  - `loading`: Show spinner, disable input/button
  - `success`: Show input + result panel with "Download Shortcut" link + "Clear" button
  - `error`: Show input + inline error alert (red/warning accent) + "Clear" button
- Download link: Direct file download, filename format: `shortcut-{YYYYMMDD-HHmmss}.shortcut`
- Motion: Spinner entrance (scale + fade), result fade-in, error slide-in (warning accent)

**Copy:** All in Indonesian (UI framework standard)

**Styling:** Match existing screens — card surfaces, system fonts, semantic colors from `tokens/theme.ts`

---

## Backend Design

### Endpoint

**Route:** `POST /shortcuts/generate`

**Request:**
```json
{
  "description": "set a 10-minute timer"
}
```

**Response (success):**
```json
{
  "shortcut": "base64-encoded-signed-.shortcut-file",
  "filename": "shortcut-20260823-143022.shortcut"
}
```

**Response (error):**
```json
{
  "error": "invalid_plist",
  "message": "Tidak bisa membuat shortcut untuk ini. Coba deskripsi yang lebih spesifik, misalnya: 'set a 5-minute timer' atau 'send a message to mom'",
  "suggestion": "Coba deskripsi yang lebih sederhana."
}
```

### Generation Logic

1. **Input validation:**
   - Length: 3–500 characters
   - Reject patterns: SQL injection, prompt injection (basic regex)
   - Return 400 Bad Request if invalid

2. **AI prompt:**
   ```
   Generate an iOS Shortcut (plist XML format) that does: {description}
   Return ONLY valid plist XML, no explanation.
   Use standard Shortcut actions available in iOS.
   If the request is impossible or dangerous (e.g., hacking, malware), 
   return an error plist that politely declines.
   ```

3. **Plist validation:**
   - Parse returned XML with minimal validation (opening/closing tags, basic structure)
   - Reject if not parseable XML
   - Return 400 if invalid, with suggestion message

4. **Signing:**
   - Load service account certificate from env var `SHORTCUT_SIGNING_CERT` (binary/PEM)
   - Load cert password from env var `SHORTCUT_CERT_PASSWORD`
   - Sign plist using OS signing tools or third-party library (TBD: research Apple codesigning on Cloudflare Workers)
   - Return signed binary as base64

5. **Rate limiting:**
   - 10 requests per IP per hour (identify by client IP address)
   - Return 429 Too Many Requests if exceeded
   - If user auth added later, can switch to per-user tracking

### Error Responses

| Scenario | Status | Message |
|----------|--------|---------|
| Description too short/long | 400 | "Deskripsi harus 3–500 karakter." |
| AI timeout | 504 | "Permintaan terlalu lama. Coba deskripsi yang lebih sederhana." |
| AI returns non-plist | 400 | "Tidak bisa membuat shortcut untuk ini. Coba deskripsi yang lebih spesifik..." |
| Cert signing fails | 500 | "Terjadi kesalahan server. Hubungi support." |
| Rate limit exceeded | 429 | "Terlalu banyak permintaan. Coba lagi dalam beberapa menit." |
| Unknown error | 500 | "Terjadi kesalahan. Coba lagi nanti." |

**Security note:** Never log user's description in error responses or logs (privacy). Log only error code + AI status server-side.

---

## Shortcut Signing & Deployment

### Certificate Management

**Service account certificate:**
- Apple Developer account (app owner's account, not per-user)
- Certificate file (`.p12` or `.cer` format) + password stored as Cloudflare env vars
- Rotate annually or on compromise

**Signing status (resolved 2026-08-24): not available, feature ships unsigned.**

Findings that settle this:

- Since iOS 15 a `.shortcut` file must be signed to import at all. Signing wraps
  the plist in an Apple Encrypted Archive. An unsigned plist is refused outright.
- "Allow Untrusted Shortcuts" does **not** work around this. That setting governs
  shortcuts from outside the Gallery, not the absence of a signature.
- Signing is only possible with `shortcuts sign` on macOS 12+. It cannot be done
  on iOS, on Linux, or on Cloudflare Workers.
- `--mode anyone` notarizes through iCloud, so it needs a Mac signed into an
  Apple ID. `--mode people-who-know-me` signs locally but restricts import to
  people who have the signer in Contacts — useless for public distribution.
- No free hosted signing API exists. RoutineHub's signing is behind a paid
  membership. CocoCloud (`cococloud-signing.vip`) signs **IPA** files, not
  shortcuts, and the `api.cococloud.dev` host assumed by the first
  implementation does not resolve at all.
- `0xilis/shortcut-sign` does sign on Linux, but needs an ECDSA-P256 key and
  auth data dumped from a jailbroken iOS device. Rejected: it depends on
  jailbreaking and on extracted Apple ID key material.

**Consequence:** the app cannot hand the user an installable file without a Mac.
The endpoint returns the plist plus a step list, and the UI tells the user
plainly that the file is unsigned and walks them through rebuilding the shortcut
by hand in the Shortcuts app.

**To enable signing later:** stand up a Mac running a signer that accepts
`{ plist }` and returns `{ signed: "<base64>" }` (e.g. `scaxyz/shortcut-signing-server`),
then set `SHORTCUT_SIGNING_URL` and, if it needs one, `SHORTCUT_SIGNING_KEY`.
No code change is required; the response's `signed` flag flips and the UI drops
the unsigned notice on its own.

### Deployment Steps

1. **Cloudflare env vars:**
   - `SHORTCUT_SIGNING_CERT`: Binary cert file (base64-encoded in wrangler.toml)
   - `SHORTCUT_CERT_PASSWORD`: Cert password (secure vault)

2. **Frontend:**
   - Add `/shortcuts` route to React app
   - Add "Pembuat Shortcut" menu entry in Lainnya hub
   - Lazy-load screen component

3. **Backend:**
   - Add `src/routes/shortcuts.ts` file with `POST /shortcuts/generate` handler
   - Register route in `src/index.ts`
   - No database migrations needed (stateless feature)

4. **Rate limiting:**
   - Use Cloudflare Durable Objects or in-memory map (reset hourly)
   - Key: `ip:{clientIP}` or `user:{userId}` if auth available

5. **Rollback:**
   - Feature flag env var `SHORTCUT_MAKER_ENABLED` (default true)
   - If signing cert fails post-deploy, set to false to disable endpoint

---

## Testing Strategy

### Unit Tests

- Input validation: reject short/long/injection patterns
- Error message formatting: no secrets leaking
- Plist parsing: validate structure detection

### Integration Tests

- Mock Workers AI: return valid plist, invalid plist, timeout
- Mock signing: verify signed file format
- Error scenarios: timeout, rate limit, cert missing

### Manual Testing (QA)

- Generate 5–10 shortcuts for common use cases (timer, message, reminder, etc.)
- Download each `.shortcut` file on Mac/iOS
- Install on real iOS device: verify no trust warning, shortcut executes correctly
- Test error cases: invalid description, rate limit hit
- Verify UI motion + state transitions

### Monitoring

- Log generation time per request (target: < 10s p95)
- Log error rates by type (timeout %, invalid plist %, signing failures %)
- Optional: Add "Did this work?" feedback button post-download

---

## Future Enhancements (Out of Scope)

- History / saved shortcuts (Approach 3)
- Preview shortcut before download (Approach 2)
- Template library + customization
- Per-user signing (Approach A, more complex auth flow)
- Sharing shortcuts with other users

---

## Dependencies & Risks

**Known unknowns:**
1. **Signing on Cloudflare Workers:** Apple's `codesign` tool requires macOS. Verify signing library availability or plan fallback (external service).
2. **Shortcut format validation:** Shortcut plist structure may require deeper validation than basic XML parsing. Research Shortcut documentation.
3. **Workers AI plist generation:** Workers AI may not reliably generate valid plist XML on first try. Plan for refinement loop or fallback model.

**Mitigation:**
- Spike: Test signing library availability before full implementation
- Spike: Test Workers AI plist generation with 10–20 examples
- Fallback: If signing unavailable, return unsigned shortcut (user accepts trust warning on install)

---

## Implementation Scope

**Files to create:**
- `frontend/src/screens/Shortcuts.tsx` (new screen component)
- `backend/src/routes/shortcuts.ts` (new endpoint)

**Files to modify:**
- `frontend/src/screens/Lainnya.tsx` (add menu entry)
- `frontend/src/index.tsx` or router config (add route)
- `backend/src/index.ts` (register route)
- `wrangler.toml` (add env vars for cert + password)

**No database changes** (stateless feature, no D1 migrations).

---

## Success Metrics

- [ ] User can generate a shortcut in < 10 seconds
- [ ] Downloaded `.shortcut` installs on iOS without trust warning
- [ ] Error rate < 5% for valid descriptions
- [ ] User receives actionable error message + suggestion on failure
- [ ] QA verifies 5+ shortcuts work end-to-end on real iOS device
