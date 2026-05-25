export interface FeedListProps {
  feeds: Array<{
    url: string;
    title?: string;
    lastFetched?: string;
    itemCount?: number;
    status?: "ok" | "error" | "pending";
  }>;
  onRemove?: (url: string) => void;
}

export function FeedList({ feeds, onRemove }: FeedListProps) {
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>
        Subscriptions ({feeds.length})
      </h2>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={{ padding: 8 }}>Feed</th>
            <th style={{ padding: 8 }}>URL</th>
            <th style={{ padding: 8 }}>Items</th>
            <th style={{ padding: 8 }}>Status</th>
            {onRemove && <th style={{ padding: 8 }}></th>}
          </tr>
        </thead>
        <tbody>
          {feeds.map((feed, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{feed.title ?? new URL(feed.url).hostname}</td>
              <td style={{ padding: 8 }}>
                <a href={feed.url} target="_blank" rel="noopener noreferrer" style={{ color: "#666", fontSize: 12 }}>
                  {feed.url.slice(0, 50)}{feed.url.length > 50 ? "..." : ""}
                </a>
              </td>
              <td style={{ padding: 8 }}>{feed.itemCount ?? "—"}</td>
              <td style={{ padding: 8 }}>
                <span style={{
                  color: feed.status === "ok" ? "#27ae60" : feed.status === "error" ? "#e74c3c" : "#999",
                }}>
                  {feed.status ?? "pending"}
                </span>
              </td>
              {onRemove && (
                <td style={{ padding: 8 }}>
                  <button onClick={() => onRemove(feed.url)} style={{ fontSize: 12, color: "#e74c3c", background: "none", border: "none", cursor: "pointer" }}>
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
