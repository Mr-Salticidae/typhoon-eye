---
name: bili-toy-publisher
description: Prepare, preview, create, update, and troubleshoot Bilibili Toy static pages safely. Use for Toy preview, publishing, updates, toy.yaml maintenance, static resource checks, permissions, passwords, audit status, and final URL verification.
---

# Bilibili Toy Publisher

Use this skill as the single source of truth for Bilibili Toy publishing. Do not use Vercel, Netlify, Cloudflare, AppDeploy, or another generic hosting service when the target is Toy.

## Mandatory workflow

1. Inspect the project and identify the static upload directory. It must contain a root `index.html`.
2. Read `toy.yaml` when present.
3. Run the bundled static-resource doctor and fix errors.
4. Generate a Toy preview with the bundled CLI.
5. Show the preview URL to the user and wait for explicit approval.
6. Only after approval, run `create` or `update`.
7. Verify the returned project ID, audit state, and final URL.

Never skip the preview gate. A request to “publish” or “update” is not approval of an unseen preview.

## Existing projects

When `toy.yaml` contains an `id`, treat the operation as an update. Preserve all of these values unless the user explicitly requests deletion and recreation:

```yaml
id: 12345
slug: existing-slug
url: https://www.bilibili.com/toy/existing-slug/index.html
title: Existing title
owner_mid: "123456"
```

Do not change a published slug during update. Do not create a second Toy when the user asked to update the existing one.

When there is no valid `id`, use the create flow and write the returned values to `toy.yaml` after success. Keep `toy.yaml` outside the uploaded ZIP.

## Static checks

Before preview, create, or update, run:

```bash
SKILL_DIR="$(pwd)/.agents/skills/bili-toy-publisher"
python3 "$SKILL_DIR/scripts/toy_doctor.py" "$STATIC_DIR" \
  --require-root-index \
  --slug "$SLUG"
```

For create, poster replacement, or permission changes that include a cover:

```bash
python3 "$SKILL_DIR/scripts/toy_doctor.py" "$STATIC_DIR" \
  --require-root-index \
  --slug "$SLUG" \
  --poster "$POSTER" \
  --require-poster
```

Fix errors before generating a preview. Review warnings, especially:

- root-relative resources such as `/assets/app.js`
- missing local assets
- native `href="#section"` navigation
- direct external links
- framework source roots instead of static build output
- non-4:3 cover images
- packages above 20 MB

Prefer relative resources such as `./assets/app.js`. For framework projects, upload `dist`, `build`, or another static output directory, not the source tree.

## Built-in Toy CLI

Always prefer the bundled CLI:

```bash
SKILL_DIR="$(pwd)/.agents/skills/bili-toy-publisher"
```

Preview:

```bash
bash "$SKILL_DIR/scripts/publish.sh" preview \
  --dir "$STATIC_DIR" \
  --uid auto
```

Create, only after preview approval:

```bash
bash "$SKILL_DIR/scripts/publish.sh" create \
  --dir "$STATIC_DIR" \
  --title "$TITLE" \
  --slug "$SLUG" \
  --poster "$POSTER" \
  --uid auto \
  --distribution-mode LINK_ONLY
```

Update, only after preview approval:

```bash
bash "$SKILL_DIR/scripts/publish.sh" update \
  --id "$ID" \
  --dir "$STATIC_DIR" \
  --title "$TITLE" \
  --poster "$POSTER" \
  --uid auto
```

The CLI defaults to the public Bilibili endpoint:

```text
https://www.bilibili.com/x/sunflower/artifex/toy
```

Do not switch to an internal host unless the user explicitly provides an approved endpoint.

## Authentication and UID

Use `~/.bilibili_cookie` by default, or `TOY_COOKIE_FILE` when set.

- Default to `--uid auto`.
- Derive the UID only from the cookie key `DedeUserID`.
- Never trust a generic `uid` cookie field.
- When the user supplies a UID, compare it with `DedeUserID` and stop on mismatch.
- Never print the complete cookie, access token, CSRF token, or password.

Exit codes:

- `0`: success
- `1`: validation, argument, or API business error
- `170`: cookie missing or empty
- `171`: login expired or unauthorized

## Distribution permissions

Supported values:

```text
PASSWORD
LINK_ONLY
PUBLIC_BIP
```

Use `--distribution-mode` only when creating or explicitly changing permissions during update.

For `PASSWORD`, ask the user to provide and confirm the password before running create/update, then pass:

```bash
--distribution-mode PASSWORD --access-password "$ACCESS_PASSWORD"
```

Never invent or expose the password. The CLI rejects `PASSWORD` without `--access-password` and rejects a password for non-password modes.

Use `LINK_ONLY` when access should be limited to people with the link. Use `PUBLIC_BIP` only when the user explicitly wants public distribution.

## Preview approval gate

After `preview` succeeds:

- provide the preview URL
- summarize static-check warnings
- state whether this is a create or update
- for update, restate the preserved `id`, `slug`, and URL
- state the requested distribution mode
- ask for explicit confirmation

Do not call `create` or `update` in the same step that first presents the preview.

## Final verification

After create/update:

- preserve or record `id`, `slug`, URL, title, `owner_mid`, and update timestamp in `toy.yaml`
- use the final URL format `https://www.bilibili.com/toy/<slug>/index.html`
- distinguish preview success, submission success, audit pending, and live status
- never claim the Toy is live before the final URL is verified or audit completion is confirmed
