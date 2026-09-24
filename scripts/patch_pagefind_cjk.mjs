/**
 * Post-build patch: fix over-broad Chinese (zh) search.
 *
 * Root cause
 * ----------
 * Pagefind 1.5.x splits CJK *queries* in the browser using the runtime
 * `Intl.Segmenter`. Chrome's ICU data tokenizes e.g. "开户" into the single
 * characters "开" / "户". However the *index* was built by Pagefind Extended's
 * bundled segmenter, which keeps "开户" as one whole word and never emits a
 * standalone "户" term. The unmatched "户" is dropped and the surviving "开"
 * alone decides the matches, returning unrelated articles (开票 / 开通 /
 * 绕不开 ...) with no <mark> highlights.
 *
 * Fix
 * ---
 * Stop word-segmenting Chinese *queries* so they stay a contiguous string
 * (the same path Pagefind uses for languages it cannot segment). The WASM
 * backend then matches the contiguous query against the whole-word index
 * correctly. Japanese / Thai keep their original behaviour.
 *
 * Runs after `pagefind.writeFiles`, so it patches the emitted browser bundle.
 * A hard error is thrown if the expected source fragment is missing, so a
 * future Pagefind upgrade that changes the bundle cannot silently disable it.
 */

import { readFile, writeFile } from "node:fs/promises";

const files = [
  "dist/pagefind/pagefind.js",
  "dist/pagefind/pagefind-worker.js",
];

const FROM = 'return["zh","ja","th"].includes(primaryLang);';
const TO = 'return["ja","th"].includes(primaryLang);';

for (const file of files) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");

  const occurrences = source.split(FROM).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `[patch_pagefind_cjk] Expected exactly 1 occurrence of the query-segmentation fragment in ${file}, found ${occurrences}. ` +
        `Pagefind may have changed this bundle — update scripts/patch_pagefind_cjk.mjs.`,
    );
  }

  const patched = source.replace(FROM, TO);
  await writeFile(new URL(`../${file}`, import.meta.url), patched, "utf8");
  console.log(`[patch_pagefind_cjk] Patched ${file}`);
}
