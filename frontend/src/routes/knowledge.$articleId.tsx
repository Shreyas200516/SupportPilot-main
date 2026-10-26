import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { getKnowledgeArticle, updateKnowledgeArticle } from "@/lib/api";
import { CATEGORIES, FACILITIES_CATEGORIES, type Article, type Category } from "@/lib/data";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/knowledge/$articleId")({ component: KnowledgeArticle });

function KnowledgeArticle() {
  const { articleId } = Route.useParams();
  const { user } = useStore();
  const canManage = user?.role === "admin" || user?.role === "support_agent";
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    summary: "",
    content: "",
    category: "",
    keywords: "",
  });

  const load = useCallback(async () => {
    try {
      const data = await getKnowledgeArticle(articleId);
      setArticle(data);
      setForm({
        title: data.title,
        summary: data.summary,
        content: data.content,
        category: data.category,
        keywords: data.keywords.join(", "),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge article could not be loaded.");
    }
  }, [articleId]);
  useEffect(() => {
    void load();
  }, [load, user]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await updateKnowledgeArticle(articleId, {
        title: form.title,
        summary: form.summary,
        content: form.content,
        category: form.category as Category,
        keywords: form.keywords
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
      });
      setArticle(updated);
      setEditing(false);
      toast.success("Knowledge article updated.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Article could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  if (!article)
    return (
      <AppShell title="Knowledge article">
        <div className="surface mx-auto max-w-3xl p-8 text-center">
          <h2 className="font-semibold">{error || "Loading guide…"}</h2>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/knowledge">Back to knowledge base</Link>
          </Button>
        </div>
      </AppShell>
    );

  return (
    <AppShell
      title={article.title}
      crumbs={[{ label: "Knowledge Base", to: "/knowledge" }, { label: article.article_id }]}
    >
      <article className="surface mx-auto max-w-3xl p-5 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="size-4" />
            {article.article_id} · {article.category} · {article.workspace}
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditing((value) => !value)}>
                {editing ? "Cancel edit" : "Edit guide"}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const saved = await updateKnowledgeArticle(article.article_id, {
                      is_published: !article.is_published,
                    });
                    setArticle(saved);
                    toast.success(
                      saved.is_published ? "Article published." : "Article moved to draft.",
                    );
                  } catch (cause) {
                    toast.error(
                      cause instanceof Error ? cause.message : "Status could not be changed.",
                    );
                  }
                }}
              >
                {article.is_published ? "Unpublish" : "Publish"}
              </Button>
            </div>
          )}
        </div>
        {editing ? (
          <form onSubmit={(event) => void save(event)} className="mt-5 grid gap-3">
            <input
              required
              minLength={5}
              maxLength={180}
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              aria-label="Article title"
            />
            <input
              required
              minLength={10}
              maxLength={500}
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              aria-label="Article summary"
            />
            <select
              required
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              aria-label="Article category"
            >
              {(article.workspace === "Facilities Helpdesk"
                ? FACILITIES_CATEGORIES
                : CATEGORIES
              ).map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <textarea
              required
              minLength={20}
              maxLength={20_000}
              rows={10}
              className="rounded-md border bg-card p-3 text-sm"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              aria-label="Article instructions"
            />
            <input
              className="h-10 rounded-md border bg-card px-3 text-sm"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              aria-label="Search keywords"
            />
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </form>
        ) : (
          <>
            <h1 className="mt-3 text-2xl font-semibold">{article.title}</h1>
            <p className="mt-2 text-muted-foreground">{article.summary}</p>
            <div className="mt-6 whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm leading-6">
              {article.content}
            </div>
            {article.keywords.length > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Search terms: {article.keywords.join(" · ")}
              </p>
            )}
            <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
              Maintained by {article.owner} · Updated{" "}
              {new Date(article.updated_at).toLocaleDateString()} ·{" "}
              {article.is_published ? "Published" : "Draft"}
            </footer>
          </>
        )}
        <Button asChild variant="ghost" className="mt-3">
          <Link to="/knowledge">
            <ArrowLeft /> All guides
          </Link>
        </Button>
      </article>
    </AppShell>
  );
}
