import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { HelpArticle, HelpCategory } from "@/lib/types";
import { Card, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

// Detects a YouTube/Vimeo/Loom URL sitting alone on its own line and swaps
// it for an embedded iframe -- the "embedded videos" requirement without
// building a full remark plugin. Everything else in the markdown body stays
// exactly as react-markdown would render it.
const VIDEO_LINE_PATTERN =
  /^(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[\w-]+)\S*$/;

function embedUrlFor(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const loom = url.match(/loom\.com\/share\/([\w-]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  return null;
}

function ArticleBody({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");
  const blocks: { type: "markdown" | "video"; content: string }[] = [];
  let buffer: string[] = [];

  function flushBuffer() {
    if (buffer.length > 0) {
      blocks.push({ type: "markdown", content: buffer.join("\n") });
      buffer = [];
    }
  }

  for (const line of lines) {
    if (VIDEO_LINE_PATTERN.test(line.trim())) {
      flushBuffer();
      blocks.push({ type: "video", content: line.trim() });
    } else {
      buffer.push(line);
    }
  }
  flushBuffer();

  return (
    <div className="prose-help flex flex-col gap-3 text-sm text-text">
      {blocks.map((block, i) =>
        block.type === "video" ? (
          <iframe
            key={i}
            src={embedUrlFor(block.content) ?? block.content}
            className="aspect-video w-full rounded-edge-sm border border-border"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <ReactMarkdown key={i}>{block.content}</ReactMarkdown>
        ),
      )}
    </div>
  );
}

export default function HelpCenter() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const categoriesQuery = useQuery({ queryKey: ["help-categories"], queryFn: () => apiClient.get<HelpCategory[]>("/help/categories") });

  const articlesQuery = useQuery({
    queryKey: ["help-articles", selectedCategoryId, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (selectedCategoryId) params.set("category_id", selectedCategoryId);
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      return apiClient.get<HelpArticle[]>(`/help/articles${qs ? `?${qs}` : ""}`);
    },
  });

  const selectedArticle = articlesQuery.data?.find((a) => a.id === selectedArticleId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-text">Help Center</h1>
        <p className="mt-1 text-sm text-text-muted">How-to guides and SOPs for using EEMS.</p>
      </div>

      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setSelectedArticleId(null);
        }}
        placeholder="Search articles..."
        className="w-full rounded-edge-sm border border-border bg-surface2 px-3 py-2 text-sm text-text outline-none focus:border-border-hover"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <Card accent className="p-3 lg:col-span-1">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Categories</p>
          <ul className="flex flex-col gap-0.5">
            <li>
              <button
                onClick={() => {
                  setSelectedCategoryId(null);
                  setSelectedArticleId(null);
                }}
                className={`w-full rounded-edge-sm px-2 py-1.5 text-left text-sm ${
                  selectedCategoryId === null ? "bg-nav-active text-edge-teal font-medium" : "text-text-muted hover:bg-surface2"
                }`}
              >
                All articles
              </button>
            </li>
            {(categoriesQuery.data ?? []).map((cat) => (
              <li key={cat.id}>
                <button
                  onClick={() => {
                    setSelectedCategoryId(cat.id);
                    setSelectedArticleId(null);
                  }}
                  className={`w-full rounded-edge-sm px-2 py-1.5 text-left text-sm ${
                    selectedCategoryId === cat.id ? "bg-nav-active text-edge-teal font-medium" : "text-text-muted hover:bg-surface2"
                  }`}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card accent className="p-3 lg:col-span-1">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Articles</p>
          {articlesQuery.isLoading && <LoadingState label="Loading..." />}
          {articlesQuery.isError && <ErrorBanner message={errorMessage(articlesQuery.error)} />}
          <ul className="flex flex-col gap-0.5">
            {(articlesQuery.data ?? []).map((article) => (
              <li key={article.id}>
                <button
                  onClick={() => setSelectedArticleId(article.id)}
                  className={`w-full truncate rounded-edge-sm px-2 py-1.5 text-left text-sm ${
                    selectedArticleId === article.id ? "bg-nav-active text-edge-teal font-medium" : "text-text-muted hover:bg-surface2"
                  }`}
                >
                  {article.title}
                </button>
              </li>
            ))}
            {(articlesQuery.data ?? []).length === 0 && !articlesQuery.isLoading && (
              <li className="px-2 py-1.5 text-sm text-text-dim">No articles found.</li>
            )}
          </ul>
        </Card>

        <Card accent className="p-4 lg:col-span-2">
          {!selectedArticle ? (
            <EmptyState message="Select an article to read it." />
          ) : (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-base font-medium text-text">{selectedArticle.title}</p>
                {selectedArticle.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedArticle.tags.map((tag) => (
                      <span key={tag} className="rounded-edge-sm bg-surface2 px-1.5 py-0.5 text-[11px] text-text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-border pt-3">
                <ArticleBody markdown={selectedArticle.body_markdown} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
