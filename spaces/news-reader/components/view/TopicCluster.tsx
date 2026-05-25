export interface TopicClusterProps {
  topic: string;
  entities: Array<{
    text: string;
    type: string;
    count: number;
  }>;
  trend: "rising" | "stable" | "declining";
  coverageVolume: {
    day: number;
    week: number;
    month: number;
  };
}

export function TopicCluster({ topic, entities, trend, coverageVolume }: TopicClusterProps) {
  const trendColor =
    trend === "rising" ? "#27ae60"
    : trend === "declining" ? "#e74c3c"
    : "#f39c12";

  const maxCount = Math.max(...entities.map((e) => e.count), 1);

  return (
    <div style={{ border: "1px solid #e0e0e0", borderRadius: 8, padding: 20, maxWidth: 600 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{topic}</h2>
        <span style={{ color: trendColor, fontWeight: 600, fontSize: 14 }}>
          {trend.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ textAlign: "center", padding: 12, background: "#f8f8f8", borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{coverageVolume.day}</div>
          <div style={{ fontSize: 12, color: "#888" }}>24h</div>
        </div>
        <div style={{ textAlign: "center", padding: 12, background: "#f8f8f8", borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{coverageVolume.week}</div>
          <div style={{ fontSize: 12, color: "#888" }}>7 days</div>
        </div>
        <div style={{ textAlign: "center", padding: 12, background: "#f8f8f8", borderRadius: 6 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{coverageVolume.month}</div>
          <div style={{ fontSize: 12, color: "#888" }}>30 days</div>
        </div>
      </div>

      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Key Entities</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {entities.slice(0, 15).map((e, i) => {
          const size = 12 + Math.round((e.count / maxCount) * 8);
          const opacity = 0.5 + (e.count / maxCount) * 0.5;
          return (
            <span
              key={i}
              style={{
                fontSize: size,
                background: "#eef",
                padding: "4px 10px",
                borderRadius: 12,
                opacity,
              }}
            >
              {e.text}
              <span style={{ fontSize: 10, color: "#999", marginLeft: 4 }}>{e.type}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
