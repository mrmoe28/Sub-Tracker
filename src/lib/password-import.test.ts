import assert from "node:assert/strict";
import { test } from "node:test";

import { registrableDomain } from "./cancellation-rank";
import { parsePasswordCsv } from "./password-import";

test("parsePasswordCsv: Chrome export with quotes, commas and dupes", () => {
  const csv = [
    "name,url,username,password,note",
    'hulu.com,https://auth.hulu.com/web/login,moe@example.com,"pa,ss""word",',
    "hulu.com,https://www.hulu.com/,moe@example.com,other,",
    "Netflix,https://www.netflix.com/login,moe@example.com,nflx,note",
    "app,android://abc@com.foo/,moe@example.com,x,",
    ",,,,",
  ].join("\r\n");
  const rows = parsePasswordCsv(csv, registrableDomain);
  assert.deepEqual(
    rows.map((r) => [r.domain, r.username, r.password]),
    [
      ["hulu.com", "moe@example.com", 'pa,ss"word'],
      ["netflix.com", "moe@example.com", "nflx"],
    ],
  );
});

test("parsePasswordCsv: unknown header -> empty", () => {
  assert.deepEqual(parsePasswordCsv("a,b,c\n1,2,3", registrableDomain), []);
});
