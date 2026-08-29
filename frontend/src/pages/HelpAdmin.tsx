import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, errorMessage } from "@/lib/apiClient";
import type { Company, HelpArticle, HelpArticleRole, HelpArticleStatus, HelpArticleVersion, HelpCategory, Role } from "@/lib/types";
import { Button, Card, EmptyState, ErrorBanner, FieldLabel, LoadingState, Table, TableEmptyRow, TableHead, Td, Th, Tr } from "@/components/ui";

const STATUSES: HelpArticleStatus[] = ["draft", "published", "archived"];

const STATUS_STYLES: Record<HelpArticleStatus, string> = {
  draft: "bg-surface2 text-text-muted",
  published: "bg-success-soft text-success",
  archived: "bg-danger/10 text-danger",
};

export default function HelpAdmin() {
  const queryClient = useQueryClient();
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: () => apiClient.get<Company[]>("/companies") });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: () => apiClient.get<Role[]>("/roles") });
  const activeCompanyId = selectedCompanyId ?? companiesQuery.data?.[0]?.id ?? null;

  const categoriesQuery = useQuery({ queryKey: ["help-categories"], queryFn: () => apiClient.get<HelpCategory[]>("/help/categories") });
  const articlesQuery = useQuery({ queryKey: ["help-articles", "admin"], queryFn: () => apiClient.get<HelpArticle[]>("/help/articles") });

  const selectedArticle = articlesQuery.data?.find((a) => a.id === selectedArticleId) ?? null;

  const articleRolesQuery = useQuery({
    queryKey: ["help-article-roles", selectedArticleId],
    queryFn: () => apiClient.get<HelpArticleRole[]>(`/help/articles/${selectedArticleId}/roles`),
    enabled: !!selectedArticleId,
  });

  const versionsQuery = useQuery({
    queryKey: ["help-article-versions", selectedArticleId],
    queryFn: () => apiClient.get<HelpArticleVersion[]>(`/help/articles/${selectedArticleId}/versions`),
    enabled: !!selectedArticleId && showVersions,
  });

  const createCategory = useMutation({
    mutationFn: (name: string) => apiClient.post<HelpCategory>("/help/categories", { company_id: activeCompanyId, name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["help-categories"] }),
  });

  const createArticle = useMutation({
    mutationFn: (payload: { title: string; category_id: string | null; body_markdown: string; tags: string[] }) =>
      apiClient.post<HelpArticle>("/help/articles", { ...payload, company_id: activeCompanyId }),
    onSuccess: (article) => {
      queryClient.invalidateQueries({ queryKey: ["help-articles", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
      setSelectedArticleId(article.id);
      setShowCreateForm(false);
    },
  });

  const updateArticle = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      apiClient.patch<HelpArticle>(`/help/articles/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["help-articles", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["help-articles"] });
      queryClient.invalidateQueries({ queryKey: ["help-article-versions", selectedArticleId] });
    },
  });

  const linkRole = useMutation({
    mutationFn: ({ articleId, roleId }: { articleId: string; roleId: string }) =>
      apiClient.post(`/help/articles/${articleId}/roles/${roleId}`, {}),
    onSuccess: (_data, { articleId }) => queryClient.invalidateQueries({ queryKey: ["help-article-roles", articleId] }),
  });

  const unlinkRole = useMutation({
    mutationFn: ({ articleId, roleId }: { articleId: string; roleId: string }) =>
      apiClient.delete(`/help/articles/${articleId}/roles/${roleId}`),
    onSuccess: (_data, { articleId }) => queryClient.invalidateQueries({ queryKey: ["help-article-roles", articleId] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Help Center Admin</h1>
          <p className="mt-1 text-sm text-text-muted">Create and manage SOP articles and categories.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeCompanyId ?? ""}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            {(companiesQuery.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setShowCreateForm((v) => !v)}>+ New article</Button>
        </div>
      </div>

      <Card accent className="p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Categories</p>
        <div className="flex flex-wrap gap-1.5">
          {(categoriesQuery.data ?? []).map((cat) => (
            <span key={cat.id} className="rounded-edge-sm bg-surface2 px-2 py-1 text-xs text-text-muted">
              {cat.name}
            </span>
          ))}
        </div>
        <NewCategoryForm
          pending={createCategory.isPending}
          error={createCategory.isError ? errorMessage(createCategory.error) : null}
          onSubmit={(name) => createCategory.mutate(name)}
        />
      </Card>

      {showCreateForm && (
        <NewArticleForm
          categories={categoriesQuery.data ?? []}
          pending={createArticle.isPending}
          error={createArticle.isError ? errorMessage(createArticle.error) : null}
          onSubmit={(payload) => createArticle.mutate(payload)}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card accent className="lg:col-span-1">
          <Table>
            <TableHead>
              <Th>Title</Th>
              <Th>Status</Th>
            </TableHead>
            <tbody>
              {articlesQuery.isLoading && (
                <tr>
                  <td colSpan={2}>
                    <LoadingState label="Loading..." />
                  </td>
                </tr>
              )}
              {(articlesQuery.data ?? []).map((article) => (
                <Tr
                  key={article.id}
                  onClick={() => {
                    setSelectedArticleId(article.id);
                    setShowVersions(false);
                  }}
                  selected={selectedArticleId === article.id}
                >
                  <Td className="text-text">{article.title}</Td>
                  <Td>
                    <span className={`rounded-edge-sm px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[article.status]}`}>
                      {article.status}
                    </span>
                  </Td>
                </Tr>
              ))}
              {articlesQuery.data?.length === 0 && <TableEmptyRow colSpan={2} message="No articles yet." />}
            </tbody>
          </Table>
        </Card>

        <Card accent className="p-4 lg:col-span-2">
          {!selectedArticle ? (
            <EmptyState message="Select an article to edit it." />
          ) : (
            <ArticleEditor
              key={selectedArticle.id}
              article={selectedArticle}
              categories={categoriesQuery.data ?? []}
              roles={rolesQuery.data ?? []}
              restrictedRoleIds={new Set((articleRolesQuery.data ?? []).map((r) => r.role_id))}
              onSave={(payload) => updateArticle.mutate({ id: selectedArticle.id, ...payload })}
              saving={updateArticle.isPending}
              saveError={updateArticle.isError ? errorMessage(updateArticle.error) : null}
              onToggleRole={(roleId, enabled) => {
                if (enabled) linkRole.mutate({ articleId: selectedArticle.id, roleId });
                else unlinkRole.mutate({ articleId: selectedArticle.id, roleId });
              }}
              showVersions={showVersions}
              onToggleVersions={() => setShowVersions((v) => !v)}
              versions={versionsQuery.data ?? []}
              versionsLoading={versionsQuery.isLoading}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function NewCategoryForm({ onSubmit, pending, error }: { onSubmit: (name: string) => void; pending: boolean; error: string | null }) {
  const [name, setName] = useState("");
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit(name.trim());
    setName("");
  }
  return (
    <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category name"
        className="flex-1 rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-xs text-text outline-none focus:border-border-hover"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding..." : "Add"}
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function NewArticleForm({
  categories,
  onSubmit,
  pending,
  error,
}: {
  categories: HelpCategory[];
  onSubmit: (payload: { title: string; category_id: string | null; body_markdown: string; tags: string[] }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    onSubmit({
      title: title.trim(),
      category_id: categoryId || null,
      body_markdown: body,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit}>
      <h3 className="mb-3 text-sm font-semibold text-text">New article</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <FieldLabel>Title</FieldLabel>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div>
          <FieldLabel>Category</FieldLabel>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <FieldLabel tooltip={<p>Comma-separated, e.g. "tasks, onboarding"</p>}>Tags</FieldLabel>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tasks, onboarding"
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel tooltip={<p>Markdown -- a YouTube/Vimeo/Loom link on its own line embeds as video.</p>}>Body</FieldLabel>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="mt-3">
        {pending ? "Creating..." : "Create article (draft)"}
      </Button>
      {error && <ErrorBanner message={error} />}
      </form>
    </Card>
  );
}

function ArticleEditor({
  article,
  categories,
  roles,
  restrictedRoleIds,
  onSave,
  saving,
  saveError,
  onToggleRole,
  showVersions,
  onToggleVersions,
  versions,
  versionsLoading,
}: {
  article: HelpArticle;
  categories: HelpCategory[];
  roles: Role[];
  restrictedRoleIds: Set<string>;
  onSave: (payload: Record<string, unknown>) => void;
  saving: boolean;
  saveError: string | null;
  onToggleRole: (roleId: string, enabled: boolean) => void;
  showVersions: boolean;
  onToggleVersions: () => void;
  versions: HelpArticleVersion[];
  versionsLoading: boolean;
}) {
  const [title, setTitle] = useState(article.title);
  const [categoryId, setCategoryId] = useState(article.category_id ?? "");
  const [body, setBody] = useState(article.body_markdown);
  const [tags, setTags] = useState(article.tags.join(", "));

  function handleSave() {
    onSave({
      title,
      category_id: categoryId || null,
      body_markdown: body,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <select
          value={article.status}
          onChange={(e) => onSave({ status: e.target.value })}
          className={`rounded-edge-sm border border-border px-2 py-1 text-xs font-medium ${STATUS_STYLES[article.status]}`}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={onToggleVersions}>
          {showVersions ? "Hide version history" : "Version history"}
        </Button>
      </div>

      {showVersions && (
        <div className="rounded-edge-sm bg-surface2 p-2">
          {versionsLoading && <LoadingState label="Loading..." />}
          <ul className="flex flex-col gap-1 text-xs text-text-muted">
            {versions.map((v) => (
              <li key={v.id}>
                v{v.version_no} &middot; {v.title} &middot; {new Date(v.edited_at).toLocaleString()}
              </li>
            ))}
            {versions.length === 0 && !versionsLoading && <li>No prior versions.</li>}
          </ul>
        </div>
      )}

      <div>
        <FieldLabel>Title</FieldLabel>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      <div>
        <FieldLabel>Category</FieldLabel>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text"
        >
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>Tags</FieldLabel>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      <div>
        <FieldLabel tooltip={<p>Markdown -- a YouTube/Vimeo/Loom link on its own line embeds as video.</p>}>Body</FieldLabel>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          className="w-full rounded-edge-sm border border-border bg-surface2 px-2 py-1.5 text-sm text-text outline-none focus:border-border-hover"
        />
      </div>

      <div>
        <FieldLabel tooltip={<p>Leave all unchecked to make it visible to everyone in the company (the default).</p>}>
          Restrict to roles
        </FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((role) => {
            const enabled = restrictedRoleIds.has(role.id);
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => onToggleRole(role.id, !enabled)}
                className={`rounded-edge-sm px-2 py-1 text-xs ${
                  enabled ? "bg-success-soft text-success" : "bg-surface2 text-text-muted"
                }`}
              >
                {role.name}
              </button>
            );
          })}
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="self-start">
        {saving ? "Saving..." : "Save changes"}
      </Button>
      {saveError && <ErrorBanner message={saveError} />}
    </div>
  );
}
