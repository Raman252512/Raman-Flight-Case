# Raman Flight Case

A responsive website for custom flight cases, with a product gallery, a contact and quote page, direct WhatsApp links, and a private quote inbox. The site uses Node.js 22 or newer and has no runtime package dependencies.

## Run locally

From this checkout:

```powershell
npm start
```

Open http://127.0.0.1:3000/. To use the inbox, set a unique admin password of at least 16 characters via the `ADMIN_PASS` environment variable before starting Node. Then visit `/admin`. Quotes are saved to the inbox; the application does not send email notifications. Admin can review requests, export a CSV, sign out, or explicitly confirm a bulk deletion.

```powershell
npm test
```

The integration test uses synthetic records in a temporary directory. It does not use or modify business data.

## Cloudflare Pages

The Git-integrated Pages project is named `raman-flight-case`. Its production branch is `main`, build command is `npm run build`, and output directory is `dist`. Use Node.js 22 or newer for builds. The build packages only public assets and the Pages Worker. Do not serve the repository root.

The Worker receives quotes at `/submit` and saves them through the private `QUOTES_DB` D1 binding in `wrangler.jsonc`. Initialize a new database with `cloudflare/schema.sql` before deploying. Do not import customer records into a preview database or commit them to Git. Disable preview branch deployments unless you configure a separate preview database.

View quote records in the Cloudflare D1 dashboard. To also enable the site's `/admin` and CSV export, add a unique password of at least 16 characters as an encrypted production secret named `ADMIN_PASS` in the Pages settings and redeploy. The Pages inbox displays the latest 100 requests; CSV export includes the latest 1,000. The hosted inbox does not include bulk deletion; manage retention through the private D1 console.

## Self-hosted Node server

Run this as a Node application. Static hosting alone cannot receive quotes. Put it behind HTTPS and set `NODE_ENV=production`, `PUBLIC_ORIGIN` to the final origin (no trailing slash), and `ADMIN_PASS` through the host's secret settings. Set `HOST=0.0.0.0` only if the platform requires it; the default is loopback. Set `PORT` as required by the host.

Point `SUBMISSIONS_FILE` to a JSON file on a private persistent volume and back it up. The default path is `.data/contact-submissions.json`; use one Node process with this file-based store. Use a shared database before scaling to multiple processes. Rate limits use the direct connection address; when requests are all relayed by one proxy, use a trusted edge rate limiter and account for the shared address.

To migrate existing requests, place the previous JSON array at the private storage path while the server is stopped. Keep it and exported CSVs out of Git. The prior repository history contains a submission file; removing it from the current tree does not erase old revisions or copies. If those records contain real customer details and the repository was shared, review access and follow your incident process before making it public.

## Content

Public files live in `public/`. The published phone, address, and WhatsApp number were carried over from the original site. Confirm the business email before publishing an email link; the address in the previous version was not verified. The gallery uses the two available case photos rather than presenting unrelated images as completed work.
