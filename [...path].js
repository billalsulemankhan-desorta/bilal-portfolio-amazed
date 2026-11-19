import { handleApi } from "../server/api.mjs";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  const handled = await handleApi(req, res);
  if (!handled) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Not found" }));
  }
}
