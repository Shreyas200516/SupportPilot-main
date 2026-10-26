import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { CATEGORIES, FACILITIES_CATEGORIES, type Article, type Category } from "@/lib/data";
import { createKnowledgeArticle, listKnowledgeArticles, updateKnowledgeArticle } from "@/lib/api";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/knowledge/")({ component: KnowledgeIndex });

function KnowledgeIndex() {
  const { user, workspace } = useStore();
  const canManage = user?.role === "admin" || user?.role === "support_agent";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    summary: "",
    content: "",
    category: "" as Category | "",
    keywords: "",
    is_published: false,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setArticles(
        await listKnowledgeArticles({
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(category ? { category } : {}),
          workspace,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge articles could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [query, category, workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh, user]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.category) {
      toast.error("Choose an article category.");
      return;
    }
    setSaving(true);
    try {
      await createKnowledgeArticle({
        ...form,
        category: form.category,
        workspace,
        keywords: form.keywords
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
      });
      toast.success("Knowledge article saved.");
      setForm({
        title: "",
        summary: "",
        content: "",
        category: "",
        keywords: "",
        is_published: false,
      });
      setShowForm(false);
      await refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Article could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublished(article: Article) {
    try {
      await updateKnowledgeArticle(article.article_id, { is_published: !article.is_published });
      await refresh();
      toast.success(article.is_published ? "Article moved to draft." : "Article published.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Article status could not be updated.");
    }
  }

  const categories = [...new Set([...CATEGORIES, ...FACILITIES_CATEGORIES])];
  return (
    <AppShell title="Knowledge Base">
      <PageHeader title="Knowledge Base" subtitle={`${articles.length} guides for ${workspace}`} />
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search guides</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, instructions, keywords…"
            className="h-9 w-full rounded-md border bg-card pl-8 pr-3 text-sm"
          />
        </label>
        <select
          className="h-9 rounded-md border bg-card px-2 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        {canManage && (
          <Button onClick={() => setShowForm((show) => !show)}>
            {showForm ? "Close editor" : "Add guide"}
          </Button>
        )}
      </div>
      {showForm && canManage && (
        <form onSubmit={(event) => void save(event)} className="surface mb-5 grid gap-3 p-4">
          <h2 className="font-semibold">New guide · {workspace}</h2>
          <input
            required
            minLength={5}
            maxLength={180}
            className="h-10 rounded-md border bg-card px-3 text-sm"
            placeholder="Guide title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            required
            minLength={10}
            maxLength={500}
            className="h-10 rounded-md border bg-card px-3 text-sm"
            placeholder="Short summary"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />
          <select
            required
            className="h-10 rounded-md border bg-card px-3 text-sm"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
          >
            <option value="">Select category</option>
            {(workspace === "Facilities Helpdesk" ? FACILITIES_CATEGORIES : CATEGORIES).map(
              (item) => (
                <option key={item}>{item}</option>
              ),
            )}
          </select>
          <textarea
            required
            minLength={20}
            maxLength={20_000}
            rows={8}
            className="rounded-md border bg-card p-3 text-sm"
            placeholder="Write the approved steps, prerequisites, and escalation instructions."
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          <input
            className="h-10 rounded-md border bg-card px-3 text-sm"
            placeholder="Search keywords, separated by commas"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) => setForm({ ...form, is_published: e.target.checked })}
            />{" "}
            Publish immediately (make visible to requesters)
          </label>
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save guide"}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <div role="alert" className="surface mb-4 p-4 text-sm text-danger">
          {error}
        </div>
      )}
      {loading ? (
        <div className="surface p-8 text-center text-sm text-muted-foreground">Loading guides…</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {articles.map((article) => (
            <div key={article.article_id} className="surface p-4">
              <Link
                to="/knowledge/$articleId"
                params={{ articleId: article.article_id }}
                className="block hover:opacity-80"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {article.article_id}
                  </span>
                  <span className="text-xs text-muted-foreground">{article.category}</span>
                </div>
                <h2 className="mt-2 font-semibold">{article.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{article.summary}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {article.workspace} · Updated {new Date(article.updated_at).toLocaleDateString()}{" "}
                  · {article.owner}
                </p>
              </Link>
              {canManage && (
                <div className="mt-3 flex items-center gap-3 border-t pt-3">
                  <span className="text-xs text-muted-foreground">
                    {article.is_published ? "Published" : "Draft"}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void togglePublished(article)}>
                    {article.is_published ? "Unpublish" : "Publish"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !error && articles.length === 0 && (
        <div className="surface p-10 text-center text-sm text-muted-foreground">
          No guides match this search. Support staff can add approved guides with “Add guide”.
        </div>
      )}
    </AppShell>
  );
}
