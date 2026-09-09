import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export interface ExtractedArticle {
  readonly title: string;
  readonly markdown: string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

/**
 * Minimum extracted-text length (characters) below which the page is treated
 * as having no real article content, rather than trusting Readability's own
 * null/non-null signal alone. Readability's `parse()` falls back to
 * returning whatever short candidate it found — even a single one-line
 * `<div>` — rather than returning `null`, once it has exhausted its stricter
 * extraction strategies. A real article body is always well above this
 * threshold; this only catches genuinely empty/boilerplate-only pages.
 */
const MIN_ARTICLE_TEXT_LENGTH = 200;

/**
 * Extracts the main-content article from a raw HTML page and converts it to
 * Markdown. Readability strips navigation/ads/boilerplate the same way a
 * reader-mode browser view does; turndown converts the remaining article HTML
 * to Markdown so the ingested page reads (and indexes) like the rest of the
 * workspace's markdown corpus — `parseMarkdownFile` in packages/core only
 * assigns titles/excerpts/tags for `.md` content.
 */
export function extractArticleMarkdown(
  html: string,
  sourceUrl: string,
): ExtractedArticle {
  const dom = new JSDOM(html, { url: sourceUrl });
  const article = new Readability(dom.window.document).parse();

  const extractedText = article?.textContent?.trim() ?? "";
  if (
    !article ||
    !article.content ||
    extractedText.length < MIN_ARTICLE_TEXT_LENGTH
  ) {
    throw new Error(
      `EXTRACT_EMPTY: could not find readable article content at ${sourceUrl}.`,
    );
  }

  const title = (article.title ?? "").trim() || sourceUrl;
  const markdown = turndown.turndown(article.content).trim();

  if (markdown.length === 0) {
    throw new Error(
      `EXTRACT_EMPTY: readable content at ${sourceUrl} converted to empty markdown.`,
    );
  }

  return { title, markdown };
}
