export interface ArticleCardProps {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  imageUrl?: string;
  credibility?: number;
  category?: string;
}

export function ArticleCard({
  title,
  url,
  snippet,
  source,
  publishedAt,
  imageUrl,
  credibility,
  category,
}: ArticleCardProps) {
  const credColor =
    credibility === undefined ? "#999"
    : credibility >= 0.8 ? "#27ae60"
    : credibility >= 0.6 ? "#f39c12"
    : "#e74c3c";

  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 16 }}>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            style={{ width: 120, height: 80, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
          />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {category && (
              <span style={{ fontSize: 11, background: "#eef", padding: "2px 8px", borderRadius: 4 }}>
                {category}
              </span>
            )}
            <span style={{ fontSize: 12, color: "#888" }}>{source}</span>
            {publishedAt && <span style={{ fontSize: 12, color: "#aaa" }}>{publishedAt}</span>}
            {credibility !== undefined && (
              <span style={{ fontSize: 11, color: credColor, fontWeight: 600 }}>
                {Math.round(credibility * 100)}%
              </span>
            )}
          </div>
          <h3 style={{ margin: "0 0 6px 0", fontSize: 16 }}>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "#1a1a1a" }}>
              {title}
            </a>
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "#555", lineHeight: 1.4 }}>{snippet}</p>
        </div>
      </div>
    </div>
  );
}
