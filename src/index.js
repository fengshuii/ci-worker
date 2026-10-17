const GITHUB_API = "https://api.github.com";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const repoPath = (env) => {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  if (!owner || !repo) throw new Error("GITHUB_OWNER and GITHUB_REPO must be set");
  return `/repos/${owner}/${repo}`;
};

const github = async (env, path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "ci-worker",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
};

const authorized = (request, env) => {
  if (!env.TRIGGER_SECRET) return true;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && token === env.TRIGGER_SECRET;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;

    try {
      if (route === "GET /health") {
        return json({
          ok: true,
          repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
          token: Boolean(env.GITHUB_TOKEN),
          triggerSecret: Boolean(env.TRIGGER_SECRET),
        });
      }

      if (route === "POST /dispatch" && !authorized(request, env)) {
        return json({ error: "unauthorized" }, 401);
      }

      if (!env.GITHUB_TOKEN) {
        return json({ error: "GITHUB_TOKEN is not configured" }, 503);
      }

      if (route === "GET /runs") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 5) || 5, 20);
        const { ok, status, data } = await github(
          env,
          `${repoPath(env)}/actions/runs?per_page=${limit}`,
        );
        if (!ok) return json({ error: data?.message ?? "github error", status }, 502);
        return json({
          total: data.total_count,
          runs: (data.workflow_runs ?? []).map((r) => ({
            id: r.id,
            workflow: r.name,
            branch: r.head_branch,
            event: r.event,
            status: r.status,
            conclusion: r.conclusion,
            url: r.html_url,
          })),
        });
      }

      if (route === "POST /dispatch") {
        let body = {};
        try {
          body = await request.json();
        } catch {
          return json({ error: "body must be JSON" }, 400);
        }

        const workflow = body.workflow ?? "ci.yml";
        if (!/^[\w.-]+\.ya?ml$/.test(workflow)) {
          return json({ error: "invalid workflow filename" }, 400);
        }
        const ref = body.ref ?? env.GITHUB_DEFAULT_BRANCH ?? "main";

        const { ok, status, data } = await github(
          env,
          `${repoPath(env)}/actions/workflows/${workflow}/dispatches`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref }),
          },
        );
        if (!ok) return json({ error: data?.message ?? "dispatch failed", status }, 502);
        return json({ dispatched: workflow, ref }, 202);
      }

      return json({ error: "not found", routes: ["GET /health", "GET /runs", "POST /dispatch"] }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },
};
