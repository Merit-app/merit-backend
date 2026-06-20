-- Migration: 037_backfill_verification_tier.sql
-- Description: Backfill sessions.verification_tier for historical VERIFIED rows
--              that predate the code now setting it. Going forward the app sets
--              this on every org-attested write (adjustVolunteerHours,
--              verifySessionAsOrg, confirmAttendance, completeEvent) and on the
--              authenticator/QR path (verifications.service). This catches the
--              rows written before those changes.
--
--              Tier rules mirror trust.service.determineVerificationTier and
--              SPEC.md "Session Verification Tier":
--                - org-attested (org_verified_by_user_id set) -> verified_institutional
--                - authenticator-verified, tier 'org_email_verified' -> verified_institutional
--                - authenticator-verified, any other tier         -> verified_basic
--                - self-reported / tracker hours                  -> left NULL (not externally verified)
--
--              Only touches status='verified' rows with verification_tier IS NULL,
--              so it never overwrites an existing tier. Idempotent — safe to
--              re-run. The institutional_whitelist nuance in determineVerificationTier
--              is not reproduced here (no clean SQL equivalent); whitelisted-but-
--              non-org-email authenticators backfill as verified_basic, which the
--              forward code will correct on the next verification.
--
-- Run in Supabase SQL Editor.

-- 1. Org admin directly attested the hours -> institutional (highest tier).
UPDATE sessions
   SET verification_tier = 'verified_institutional'
 WHERE status = 'verified'
   AND verification_tier IS NULL
   AND org_verified_by_user_id IS NOT NULL;

-- 2. Authenticator (SMS / magic-link supervisor) verified, no org attestation.
UPDATE sessions s
   SET verification_tier = CASE
         WHEN a.tier = 'org_email_verified' THEN 'verified_institutional'
         ELSE 'verified_basic'
       END
  FROM authenticators a
 WHERE s.authenticator_id = a.id
   AND s.status = 'verified'
   AND s.verification_tier IS NULL
   AND s.org_verified_by_user_id IS NULL;

-- Self-reported / tracker sessions (authenticator_id NULL, org_verified_by_user_id
-- NULL) intentionally keep verification_tier = NULL: they are self-attested, not
-- externally verified, and stats.service only counts 'verified_institutional'.
