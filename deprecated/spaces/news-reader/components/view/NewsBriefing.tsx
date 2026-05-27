export interface BriefingArticle {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  category: string;
}

export interface NewsBriefingProps {
  date: string;
  leadStory?: {
    title: string;
    url: string;
    content: string;
    source: string;
  };
  categories: Array<{
    name: string;
    articles: BriefingArticle[];
    featured?: BriefingArticle & { content: string };
  }>;
  stats?: { totalArticles: number; feedsChecked: number };
}

export function NewsBriefing({ date, leadStory, categories, stats }: NewsBriefingProps) {
  return (
    <div style={{ maxWidth: 720, fontFamily: "Georgia, serif" }}>
      <h1 style={{ borderBottom: "3px solid #1a1a1a", paddingBottom: 8 }}>
        Morning Briefing — {date}
      </h1>

      {leadStory && (
        <div style={{ background: "#f8f8f8", padding: 16, borderRadius: 8, marginBottom: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: 20 }}>{leadStory.title}</h2>
          <p style={{ fontSize: 12, color: "#888", margin: "4px 0 12px" }}>{leadStory.source}</p>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>{leadStory.content.slice(0, 600)}</p>
          <a href={leadStory.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
            Read full article
          </a>
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat.name} style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, borderBottom: "1px solid #eee", paddingBottom: 4 }}>
            {cat.name} <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>({cat.articles.length})</span>
          </h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {cat.articles.slice(0, 5).map((art, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                <strong>{art.title}</strong>{" "}
                <a href={art.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#666" }}>
                  [{art.source}]
                </a>
                {art.publishedAt && (
                  <span style={{ fontSize: 11, color: "#aaa", marginLeft: 8 }}>{art.publishedAt}</span>
                )}
              </li>
            ))}
          </ul>
          {cat.featured && (
            <div style={{ background: "#fafafa", padding: 12, borderRadius: 6, fontSize: 13, lineHeight: 1.5 }}>
              <em>{cat.featured.content.slice(0, 400)}</em>
            </div>
          )}
        </div>
      ))}

      {stats && (
        <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, fontSize: 12, color: "#999" }}>
          Generated from {stats.totalArticles} articles across {stats.feedsChecked} feeds.
        </div>
      )}
    </div>
  );
}
