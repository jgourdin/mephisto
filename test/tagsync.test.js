const { test } = require("node:test");
const assert = require("node:assert");
const T = require("../src/tagsync.js");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64({ alg: "ES256" })}.${b64(p)}.sig`;

test("parseAuthToken lit un cookie base64- non chunké", () => {
  const at = jwt({ sub: "u1" });
  const val = "base64-" + Buffer.from(JSON.stringify({ access_token: at })).toString("base64");
  assert.strictEqual(T.parseAuthToken("x=1; sb-ref-auth-token=" + encodeURIComponent(val)), at);
});

test("parseAuthToken recompose .0/.1", () => {
  const at = jwt({ sub: "u2" });
  const raw = "base64-" + Buffer.from(JSON.stringify({ access_token: at })).toString("base64");
  const mid = Math.floor(raw.length / 2);
  const c = "sb-ref-auth-token.0=" + encodeURIComponent(raw.slice(0, mid)) + "; sb-ref-auth-token.1=" + encodeURIComponent(raw.slice(mid));
  assert.strictEqual(T.parseAuthToken(c), at);
});

test("jwtSub extrait sub", () => {
  assert.strictEqual(T.jwtSub(jwt({ sub: "abc" })), "abc");
});
