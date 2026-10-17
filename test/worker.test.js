import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const base = "https://worker.test";
const env = {
  GITHUB_OWNER: "acme",
  GITHUB_REPO: "app",
  GITHUB_DEFAULT_BRANCH: "trunk",
  GITHUB_TOKEN: "gh-token",
  TRIGGER_SECRET: "s3cret",
};

const call = (path, init, e = env) => worker.fetch(new Request(base + path, init), e);

const withFetch = (handler, fn) => async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
};

test("health exposes repo and config flags", async () => {
  const res = await call("/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    ok: true,
    repo: "acme/app",
    token: true,
    triggerSecret: true,
  });
});

test("missing token is reported, not crashed", async () => {
  const res = await call("/runs", undefined, { ...env, GITHUB_TOKEN: undefined });
  assert.equal(res.status, 503);
});

test("dispatch posts to the workflow endpoint with ref", withFetch(
  () => new Response(null, { status: 204 }),
  async (calls) => {
    const res = await call("/dispatch", {
      method: "POST",
      headers: { authorization: "Bearer s3cret", "content-type": "application/json" },
      body: JSON.stringify({ workflow: "deploy.yml" }),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { dispatched: "deploy.yml", ref: "trunk" });
    assert.equal(calls[0].url, "https://api.github.com/repos/acme/app/actions/workflows/deploy.yml/dispatches");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { ref: "trunk" });
  },
));

test("dispatch rejects a missing or wrong trigger secret", async () => {
  assert.equal((await call("/dispatch", { method: "POST", body: "{}" })).status, 401);
  const wrong = await call("/dispatch", {
    method: "POST",
    headers: { authorization: "Bearer nope" },
    body: "{}",
  });
  assert.equal(wrong.status, 401);
});

test("an unauthenticated dispatch is 401 even without a token", async () => {
  const res = await call("/dispatch", { method: "POST", body: "{}" }, { ...env, GITHUB_TOKEN: undefined });
  assert.equal(res.status, 401);
});

test("dispatch rejects path traversal in workflow name", async () => {
  const res = await call("/dispatch", {
    method: "POST",
    headers: { authorization: "Bearer s3cret", "content-type": "application/json" },
    body: JSON.stringify({ workflow: "../../evil.yml" }),
  });
  assert.equal(res.status, 400);
});

test("runs maps the GitHub payload", withFetch(
  () => Response.json({
    total_count: 1,
    workflow_runs: [{
      id: 7,
      name: "ci",
      head_branch: "trunk",
      event: "push",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/acme/app/actions/runs/7",
    }],
  }),
  async () => {
    const res = await call("/runs?limit=99");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.runs[0].conclusion, "success");
  },
));
