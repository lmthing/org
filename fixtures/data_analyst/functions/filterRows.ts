export function filterRows(rows: Record<string, string>[], column: string, operator: '==' | '!=' | '>' | '<' | 'contains', value: string): Record<string, string>[] {
  return rows.filter(row => {
    const cell = row[column] ?? '';
    const numCell = parseFloat(cell);
    const numValue = parseFloat(value);
    switch (operator) {
      case '==': return cell === value;
      case '!=': return cell !== value;
      case '>': return !isNaN(numCell) && !isNaN(numValue) && numCell > numValue;
      case '<': return !isNaN(numCell) && !isNaN(numValue) && numCell < numValue;
      case 'contains': return cell.toLowerCase().includes(value.toLowerCase());
      default: return true;
    }
  });
}
