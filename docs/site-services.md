# Site services and activation

The website remains on GitHub Pages. Publication search works with no external account. One small Cloudflare Worker provides the contact endpoint, daily page counts, and an owner-only editor. It has been implemented and tested locally; the server features need the account setup below before they can go live.

## Publication updates

The `Check PubMed publications` GitHub Action runs Mondays at **13:23 UTC** and can be started from Actions → Check PubMed publications → Run workflow. It searches `Machaalani M[Author]`, confirms the author surname/initial, and opens or updates one pull request for missing journal publications. It skips PubMed records marked as preprints, corrections, or retractions. It never replaces existing curated records. Topic labels are suggestions based on titles and PubMed subject headings; authorship, metadata and summaries should be reviewed before merging.

In repository Settings → Actions → General, enable **Allow GitHub Actions to create and approve pull requests** if the workflow reports that pull-request creation is blocked. The workflow requests `contents: write` and `pull-requests: write` for this repository. GitHub disables scheduled workflows on inactive public repositories after 60 days; re-enable it if necessary.

The default `GITHUB_TOKEN` can create the publication PR, but GitHub does not start other workflows from its events. If you want automatic preview checks on these PRs, add an optional repository secret `PUBMED_PR_TOKEN`: a fine-grained token restricted to this repository with Contents and Pull requests read/write. Otherwise manually run Site checks on the publication branch before merging. The editor uses its separate token, which does trigger checks.

Optional: add `NCBI_EMAIL` as a GitHub Actions secret for an NCBI contact address. No PubMed key is required. To inspect records manually:

```sh
python3 scripts/import_pubmed_publications.py              # preview only
python3 scripts/import_pubmed_publications.py --write      # add missing records
python3 scripts/import_pubmed_publications.py --enrich     # preview metadata additions
```

## One-time account setup

Your personal email can receive messages. You need a Cloudflare account for the Worker and a Resend account for delivery. No custom domain is needed for the website or Worker. Resend's testing sender can send only to the email address associated with your Resend account; use that address as `CONTACT_TO`, or verify a sender domain for broader delivery. The form forwards messages only to you, so the sender restriction can fit this use case. Check provider terms and plan limits before activation.

1. Sign up or sign in at [Cloudflare](https://dash.cloudflare.com/) and [Resend](https://resend.com/). Account creation and email verification need the owner's participation.
2. In Resend, create a sending API key. Pick a fixed From address allowed by your account (`Website <onboarding@resend.dev>` for the testing sender, or an address on a verified sender domain).
3. In Cloudflare Turnstile, create a **Managed** widget for `marcmachaalani.github.io`. Keep its secret for the Worker; its site key is public.
4. Create a [GitHub OAuth app](https://github.com/settings/applications/new) for owner sign-in. Set its Homepage URL to the Worker `/admin/` URL and callback to `https://YOUR-WORKER.workers.dev/auth/callback`. The login requests no repository OAuth scope.
5. Create a **fine-grained GitHub token** limited to `MarcMachaalani/marcmachaalani.github.io`, granting **Contents: read/write** and **Pull requests: read/write**, with a suitable expiration. The Worker uses this token only server-side to create content draft branches and PRs. No Actions, Secrets, Administration or Workflows access is needed. Renew it before expiration.

## Deploy the Worker

Run these commands from `services/site-api/`. Secret commands prompt privately; never commit values or paste them into chat. Wrangler's browser login requires the account owner.

```sh
npm ci
npx wrangler login
npx wrangler d1 create marc-site-usage
```

Copy the returned database ID into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`, then initialize the aggregate table:

```sh
npx wrangler d1 migrations apply marc-site-usage --remote
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put CONTACT_TO
npx wrangler secret put CONTACT_FROM
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GITHUB_CONTENT_TOKEN
npx wrangler secret put SESSION_SECRET
npm test
npm run check
npm run deploy
```

`SESSION_SECRET` must be a randomly generated string of at least 32 characters. Use a password manager to generate and store it. `CONTACT_TO` is your receiving personal email. `CONTACT_FROM` is the fixed provider-approved sender. The receiving address and service credentials are never exposed to visitors.

Keep `OWNER_ID` as `103030028` (MarcMachaalani). The editor uses an eight-hour signed, Secure, HttpOnly, SameSite cookie and CSRF checks. The OAuth token is used only to verify identity and is not stored. The content token stays in Worker secrets. All editor API routes require the owner ID; the login-page HTML itself is public. Only designated content files can be changed through the editor.

## Activate the public pages

After deployment, update `_data/services.yml`:

```yaml
api_base: "https://YOUR-WORKER.workers.dev"
turnstile_site_key: "YOUR_PUBLIC_TURNSTILE_SITE_KEY"
analytics_enabled: true
```

Merge those public settings and the database ID into the repository. The contact form is shown only when both public contact settings exist. Analytics requests are sent only when explicitly enabled. The `/admin/` page links to the Worker editor. Contact and Privacy are linked in the footer.

Confirm all of the following after activation:

- Submit one test message and confirm it arrives in the receiving inbox; an invalid/expired Turnstile token must be rejected.
- Open `/admin/`, sign in as MarcMachaalani, edit a sentence, save a draft, and inspect the resulting PR and its Site checks artifact. Another GitHub account must get a denial.
- Visit a public page, then check Page counts in the private editor. Counts record only canonical paths from the built site's page allowlist.
- Confirm the Worker daily cleanup cron is enabled and both rate-limit bindings are present.

## Daily editing

Open `https://marcmachaalani.github.io/admin/` → **Open private editor** → **Sign in with GitHub**. Select a page or publication, edit its fields and body, then **Save draft for review**. The editor preserves permalinks, redirects, and other unedited metadata. It detects conflicts if the published file changed while you were editing. Each save creates a new draft PR; it does not overwrite an earlier draft. Publishing remains the repository's review-and-merge step.

The content editor is authenticated, but this is a **public repository**: draft PRs and their content are public. This workflow is for editing public site content, not for storing private notes. It supports existing pages, publications, talks, and media records. New papers are created by the PubMed importer.

## Privacy and limits

Analytics stores `(UTC day, canonical page path, aggregate views)` for at most 90 days, with no visitor IDs, IPs, referrers, query strings, or fingerprinting in D1. It respects Do Not Track and Global Privacy Control. It measures page views, not unique people; blockers and automated traffic affect counts. The dashboard shows the last 30 days and is owner-only. Cloudflare transiently processes network addresses for rate limiting and network delivery. Provider operational logs are separate from the application database; Worker observability is disabled in this configuration.

The contact endpoint validates lengths and email formatting, enforces the exact website origin, checks a honeypot, applies a 3-per-minute rate limit per network address, and verifies Turnstile's hostname and action server-side. Rate limits are local to Cloudflare locations, so they are abuse reduction rather than a global quota. It forwards a plain-text message through Resend and does not retain message content in D1 or GitHub. Provider and inbox retention are governed by those accounts.

## Verification and references

Run `python3 -m unittest discover -s tests -p 'test_*.py'`, then `npm test` and `npm run check` in `services/site-api`, and `bundle exec jekyll build --safe` in the repository. CI runs these checks and attaches the static site as a `site-preview` artifact for review.

- [Cloudflare Worker configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Worker rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Resend testing sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email)
- [GitHub OAuth flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub workflow triggering restrictions](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)

## Uploads and photo galleries

The editor now has a **Media library** tab with drag-and-drop uploads and progress feedback. Open a publication to attach a PDF in **Paper PDF**, or collect files in the library first. A saved PDF association is separate from the publisher/DOI link. Paper PDFs stay behind the owner-authenticated API, including after the content draft is published. No public PDF download route or button is provided.

For photos, choose **Upload photos** or **Choose from your library** on any editable page. Add an image description for accessibility and an optional caption. You can reorder or remove photos from the page before saving its draft. Photos are resized to at most 2,200 pixels on their longest edge and re-encoded as WebP in the browser, removing embedded camera metadata. A photo becomes publicly viewable only when its ID appears in a published page's gallery. Unattached uploads and unmerged drafts remain private. Public photo changes can take about 30 seconds to appear.

Files use the existing D1 database in 128 KB chunks, avoiding another storage service. The media library allows 200 MB total, with a 10 MB limit per PDF and 6 MB per prepared photo. It retains uploads until intentionally managed; removing an attachment or gallery item only removes its association and keeps the file in your library. The daily cleanup removes only incomplete uploads older than one day. Larger libraries should move binary files to object storage while keeping the same private API.

Deploy the additive `0002_private_media.sql` migration before updating the Worker:

```sh
npx wrangler d1 migrations apply marc-site-usage --remote
npm run deploy
```

No new secrets or public storage permissions are needed. The private endpoint is `/api/assets/:id`. `/photos/:id` accepts only actual photos listed in the published site's `assets/data/published-photos.json`; even an allowlisted PDF ID is rejected. The public templates never render `private_pdf` attachments.
