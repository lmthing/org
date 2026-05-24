export interface DocumentUploadProps {
  defaultType?: string;
  allowedTypes?: string[];
  prompt?: string;
}

export interface DocumentUploadResult {
  base64Data: string;
  mimeType: string;
  documentType: string;
  fileName: string;
}

export function DocumentUpload({
  defaultType,
  allowedTypes = [
    "lab_results",
    "prescription",
    "doctor_notes",
    "medication_label",
    "imaging_report",
    "vaccination",
    "allergy",
    "surgical_report",
    "discharge_summary",
    "referral",
    "vital_signs",
  ],
  prompt = "Upload a photo of your medical document",
}: DocumentUploadProps) {
  return (
    <form className="document-upload">
      <p>{prompt}</p>
      <div className="upload-area">
        <input type="file" accept="image/*" name="document" />
      </div>
      {!defaultType && (
        <select name="documentType">
          <option value="">Auto-detect type</option>
          {allowedTypes.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      )}
      <button type="submit">Analyze Document</button>
    </form>
  );
}
