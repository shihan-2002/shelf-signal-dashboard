# Shelf Signal analyst (Cloudflare Worker)

Answers the dashboard's "Ask your own question" box with **Claude Sonnet 5.5**. The Anthropic API key lives only in this Worker as a secret, so the public dashboard page never contains it.

- Answers only from the project facts in `src/context.js` (results, models, limitations), in two to five sentences.
- Only accepts requests from `https://shihan-2002.github.io` (and `localhost:8765` for testing).
- At most 10 questions per visitor per minute; questions are capped at 500 characters.
- Each answer costs roughly a fraction of a cent (Sonnet 5.5, short answers, cached system prompt).

## One-time setup (about 10 minutes)

1. Create a free Cloudflare account at <https://dash.cloudflare.com/sign-up>.
2. In this folder, install and log in:
   ```bash
   cd worker
   npm install
   npx wrangler login
   ```
3. Store your Anthropic API key as a Worker secret (you paste it at the prompt; it is never written to a file):
   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
4. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints the Worker URL, like `https://shelf-signal-analyst.<your-subdomain>.workers.dev`.
5. Put that URL in the dashboard: in `index.html`, set
   ```js
   const ASK_ENDPOINT = "https://shelf-signal-analyst.<your-subdomain>.workers.dev";
   ```
   then push. The question box appears only when `ASK_ENDPOINT` is set.

**Recommended:** in the Anthropic Console, set a monthly spend limit on the workspace that owns this key, so a burst of traffic can't run up a bill.

## Local testing

Create `worker/.dev.vars` (git-ignored) with `ANTHROPIC_API_KEY=...`, run `npm run dev`, and point a local copy of the dashboard at `http://localhost:8787`.

## Updating the facts

If the results change, edit `src/context.js` and run `npx wrangler deploy` again.
