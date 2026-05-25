export interface ComparisonTableProps {
  query: string;
  sources: Array<{
    source: string;
    url: string;
    title: string;
    framing: string;
    keyClaims: string[];
  }>;
  commonClaims: string[];
  divergentClaims: Array<{ claim: string; sources: string[] }>;
}

export function ComparisonTable({
  query,
  sources,
  commonClaims,
  divergentClaims,
}: ComparisonTableProps) {
  return (
    <div style={{ maxWidth: 800 }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Coverage Comparison</h2>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        How different outlets cover: <strong>{query}</strong>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 24 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "left" }}>
            <th style={{ padding: 8 }}>Source</th>
            <th style={{ padding: 8 }}>Headline</th>
            <th style={{ padding: 8 }}>Framing</th>
            <th style={{ padding: 8 }}>Key Claims</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s, i) => {
            const framingColor =
              s.framing === "neutral" ? "#3498db"
              : s.framing === "sensational" ? "#e74c3c"
              : s.framing === "critical" ? "#e67e22"
              : s.framing === "positive" ? "#27ae60"
              : s.framing === "negative" ? "#c0392b"
              : "#999";
            return (
              <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: 8 }}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "#333" }}>
                    {s.source}
                  </a>
                </td>
                <td style={{ padding: 8, maxWidth: 250 }}>{s.title}</td>
                <td style={{ padding: 8 }}>
                  <span style={{ background: framingColor, color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>
                    {s.framing}
                  </span>
                </td>
                <td style={{ padding: 8 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {s.keyClaims.slice(0, 2).map((c, j) => (
                      <li key={j} style={{ marginBottom: 2 }}>{c.slice(0, 80)}{c.length > 80 ? "..." : ""}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {commonClaims.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, color: "#27ae60" }}>Common Claims ({commonClaims.length})</h3>
          <ul style={{ fontSize: 13, paddingLeft: 20 }}>
            {commonClaims.slice(0, 5).map((c, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{c.slice(0, 120)}</li>
            ))}
          </ul>
        </div>
      )}

      {divergentClaims.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, color: "#e74c3c" }}>Divergent Claims ({divergentClaims.length})</h3>
          <ul style={{ fontSize: 13, paddingLeft: 20 }}>
            {divergentClaims.slice(0, 5).map((c, i) => (
              <li key={i} style={{ marginBottom: 4 }}>
                {c.claim.slice(0, 120)} <span style={{ color: "#888", fontSize: 11 }}>({c.sources.join(", ")})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
