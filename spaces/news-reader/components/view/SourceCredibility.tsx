export interface SourceCredibilityProps {
  domain: string;
  credibilityScore: number;
  biasRating: string;
  factualityRating: string;
  type: string;
  country?: string;
  foundedYear?: number;
  concerns?: string[];
  recommendation: "Trusted" | "Caution" | "Avoid";
}

export function SourceCredibility({
  domain,
  credibilityScore,
  biasRating,
  factualityRating,
  type,
  country,
  foundedYear,
  concerns,
  recommendation,
}: SourceCredibilityProps) {
  const recColor =
    recommendation === "Trusted" ? "#27ae60"
    : recommendation === "Caution" ? "#f39c12"
    : "#e74c3c";

  const barWidth = Math.round(credibilityScore * 100);
  const barColor =
    credibilityScore >= 0.8 ? "#27ae60"
    : credibilityScore >= 0.6 ? "#f39c12"
    : "#e74c3c";

  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 20, maxWidth: 500 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{domain}</h2>
        <span style={{ background: recColor, color: "#fff", padding: "4px 12px", borderRadius: 4, fontSize: 13, fontWeight: 600 }}>
          {recommendation}
        </span>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
          <span>Credibility</span>
          <span>{Math.round(credibilityScore * 100)}%</span>
        </div>
        <div style={{ background: "#eee", borderRadius: 4, height: 8 }}>
          <div style={{ background: barColor, borderRadius: 4, height: 8, width: `${barWidth}%` }} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13, marginBottom: 16 }}>
        <div><strong>Bias:</strong> {biasRating}</div>
        <div><strong>Factuality:</strong> {factualityRating}</div>
        <div><strong>Type:</strong> {type.replace(/_/g, " ")}</div>
        <div><strong>Country:</strong> {country ?? "Unknown"}</div>
        {foundedYear && <div><strong>Founded:</strong> {foundedYear}</div>}
      </div>

      {concerns && concerns.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>Concerns</h3>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
            {concerns.map((c, i) => (
              <li key={i} style={{ color: "#c0392b", marginBottom: 2 }}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
