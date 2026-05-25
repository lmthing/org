export interface AddFeedProps {
  placeholder?: string;
  submitLabel?: string;
}

export interface AddFeedResult {
  url: string;
  action: "add" | "import";
  opmlSource?: string;
}

export function AddFeed({
  placeholder = "https://example.com/feed.xml",
  submitLabel = "Add Feed",
}: AddFeedProps) {
  return (
    <form>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4, fontWeight: 600 }}>
          RSS / Atom / JSON Feed URL
        </label>
        <input
          name="url"
          type="url"
          placeholder={placeholder}
          style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }}
          required
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 14, marginBottom: 4, fontWeight: 600 }}>
          Or import OPML file
        </label>
        <input name="opmlSource" type="text" placeholder="OPML file path or URL" style={{ width: "100%", padding: 8, fontSize: 14, border: "1px solid #ddd", borderRadius: 4, boxSizing: "border-box" }} />
      </div>
      <button type="submit" style={{ padding: "8px 24px", background: "#3498db", color: "#fff", border: "none", borderRadius: 4, fontSize: 14, cursor: "pointer" }}>
        {submitLabel}
      </button>
    </form>
  );
}
