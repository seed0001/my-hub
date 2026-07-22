/**
 * Web access for the assistant: DuckDuckGo search (HTML endpoint, no API
 * key needed) and a simple page-to-text fetcher.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** DDG result links point through /l/?uddg=<encoded-real-url>. */
function resolveDdgUrl(href: string): string {
  try {
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

export async function ddgSearch(
  query: string,
  maxResults = 6
): Promise<SearchResult[]> {
  const res = await fetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);
  const html = await res.text();

  const results: SearchResult[] = [];
  // Each organic result: <a class="result__a" href="...">Title</a>
  // ... <a class="result__snippet" ...>snippet</a>
  const linkRe =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe =
    /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < maxResults * 2) {
    const url = resolveDdgUrl(m[1]);
    const title = decodeEntities(m[2].replace(/<[^>]*>/g, "").trim());
    if (!url.startsWith("http")) continue;
    // Skip DDG ad redirects.
    if (url.includes("duckduckgo.com/y.js")) continue;
    links.push({ url, title });
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < maxResults * 2) {
    snippets.push(decodeEntities(m[1].replace(/<[^>]*>/g, "").trim()));
  }

  for (let i = 0; i < links.length && results.length < maxResults; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }
  return results;
}

const MAX_PAGE_CHARS = 8_000;

/** Fetch a web page and reduce it to readable text for the model. */
export async function fetchPageText(rawUrl: string): Promise<{
  url: string;
  title: string | null;
  text: string;
  truncated: boolean;
}> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);

  const contentType = res.headers.get("content-type") || "";
  const body = await res.text();

  if (!contentType.includes("html")) {
    const text = body.slice(0, MAX_PAGE_CHARS);
    return { url, title: null, text, truncated: body.length > MAX_PAGE_CHARS };
  }

  const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/\s+/g, " ").trim())
    : null;

  const text = decodeEntities(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    url,
    title,
    text: text.slice(0, MAX_PAGE_CHARS),
    truncated: text.length > MAX_PAGE_CHARS,
  };
}
