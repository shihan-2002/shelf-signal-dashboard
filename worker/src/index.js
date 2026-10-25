// Shelf Signal analyst: a small Cloudflare Worker that answers dashboard questions with
// Claude Sonnet 5.5. The Anthropic API key lives only here, as a Worker secret, so the
// public dashboard page never sees it.
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./context.js";

const MODEL = "claude-sonnet-5-5";
const MAX_QUESTION_CHARS = 500;

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function reply(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    const allowed = cors["Access-Control-Allow-Origin"] === origin;

    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405, cors);
    if (!allowed) return reply({ error: "This endpoint only serves the Shelf Signal dashboard." }, 403, cors);

    // Per-visitor rate limit (Cloudflare Rate Limiting binding, see wrangler.toml).
    if (env.ASK_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const { success } = await env.ASK_LIMITER.limit({ key: ip });
      if (!success) return reply({ error: "Too many questions in a short time. Please wait a minute." }, 429, cors);
    }

    let question;
    try {
      ({ question } = await request.json());
    } catch {
      return reply({ error: "Send JSON like {\"question\": \"...\"}." }, 400, cors);
    }
    question = typeof question === "string" ? question.trim() : "";
    if (!question) return reply({ error: "Please type a question." }, 400, cors);
    if (question.length > MAX_QUESTION_CHARS)
      return reply({ error: `Please keep questions under ${MAX_QUESTION_CHARS} characters.` }, 400, cors);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" }, // short factual chat answers
        cache_control: { type: "ephemeral" }, // the system prompt is the same on every call
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: question }],
      });

      if (response.stop_reason === "refusal") {
        return reply({ answer: "I can't answer that one. Try a question about the project's models, results or dashboard." }, 200, cors);
      }
      const answer = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return reply({ answer: answer || "I couldn't produce an answer. Please try rephrasing." }, 200, cors);
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        return reply({ error: "The analyst is busy right now. Please try again shortly." }, 503, cors);
      }
      if (error instanceof Anthropic.AuthenticationError) {
        return reply({ error: "The analyst is not configured (API key missing or invalid)." }, 500, cors);
      }
      if (error instanceof Anthropic.APIError) {
        return reply({ error: `The analyst had a problem (API error ${error.status}). Please try again.` }, 502, cors);
      }
      return reply({ error: "The analyst could not be reached. Please try again." }, 502, cors);
    }
  },
};
