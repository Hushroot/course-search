# StudyStream v1.12.0 - provider diagnostics patch

Changes:
- Removed redundant `allowfullscreen` from the video iframe; `allow="fullscreen"` is already present.
- Provider verification classification now includes a non-sensitive stage: `login_page`, `login_submission`, or `account_validation`. The provider's original challenge safeguards are unchanged.
- Railway server logs include this stage for `PROVIDER_CHALLENGE` without logging passwords, cookies, or provider HTML.
- User-facing login errors explain the stage and display the duration from `Retry-After` for HTTP 429.
- Added an integration assertion verifying the challenge stage.

This patch DOES NOT circumvent verification or guarantee successful login. If direct login succeeds, an integration false positive, server-side challenge, or provider access policy still needs investigation. Avoid rapid repeated retries.

Separate issue: `SCAN_FAILED 502` comes from the admin auto-scanner, which uses its own saved Infinity cookie. Check its last error in the admin panel and refresh the provider cookie through authorized means if expired.

Verify: `npm run check && npm test` (28 tests passing in the test environment).

Deploy by updating the Railway application's source repository with this project's files and triggering a deployment. Preserve the existing Railway environment variables and persistent state.
