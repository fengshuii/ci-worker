import { createServer } from "node:http";
import worker from "../src/index.js";

const port = Number(process.env.PORT ?? 8787);
const env = {
  GITHUB_OWNER: process.env.GITHUB_OWNER ?? "fengshuii",
  GITHUB_REPO: process.env.GITHUB_REPO ?? "water-web",
  GITHUB_DEFAULT_BRANCH: process.env.GITHUB_DEFAULT_BRANCH ?? "main",
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  TRIGGER_SECRET: process.env.TRIGGER_SECRET,
};

createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const request = new Request(`http://localhost:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body,
  });

  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
}).listen(port, () => {
  console.log(`ci-worker listening on http://localhost:${port}`);
});
