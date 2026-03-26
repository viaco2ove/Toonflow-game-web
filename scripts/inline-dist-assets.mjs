import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.join(projectRoot, "dist");
const htmlPath = path.join(distDir, "index.html");

function escapeInlineScript(code) {
  return code.replace(/<\/script>/gi, "<\\/script>");
}

async function inlineAssetTag(html, tagPattern, resolver) {
  let replaced = false;
  const nextHtml = await replaceAsync(html, tagPattern, async (fullMatch, assetPath) => {
    replaced = true;
    const absolutePath = path.resolve(distDir, assetPath);
    return resolver(await readFile(absolutePath, "utf8"), assetPath);
  });
  return { html: nextHtml, replaced };
}

function replaceAsync(input, pattern, replacer) {
  const matches = [...input.matchAll(pattern)];
  if (!matches.length) return Promise.resolve(input);

  return (async () => {
    let cursor = 0;
    const segments = [];

    for (const match of matches) {
      const [fullMatch, ...groups] = match;
      const index = match.index ?? 0;
      const replacement = await replacer(fullMatch, ...groups, index, input);
      segments.push(input.slice(cursor, index), replacement);
      cursor = index + fullMatch.length;
    }

    segments.push(input.slice(cursor));
    return segments.join("");
  })();
}

async function main() {
  let html = await readFile(htmlPath, "utf8");

  const cssResult = await inlineAssetTag(
    html,
    /<link\s+rel="stylesheet"[^>]*href="(.+?)"[^>]*>/g,
    (css, assetPath) => `<style data-inline-href="${assetPath}">\n${css}\n</style>`,
  );
  html = cssResult.html;

  const jsResult = await inlineAssetTag(
    html,
    /<script\s+type="module"[^>]*src="(.+?)"[^>]*><\/script>/g,
    (js, assetPath) => `<script type="module" data-inline-src="${assetPath}">\n${escapeInlineScript(js)}\n</script>`,
  );
  html = jsResult.html;

  if (!cssResult.replaced && !jsResult.replaced) {
    console.warn("No external CSS/JS tags found in dist/index.html");
    return;
  }

  await writeFile(htmlPath, html, "utf8");
  console.log("Inlined dist assets into dist/index.html");
}

await main();
