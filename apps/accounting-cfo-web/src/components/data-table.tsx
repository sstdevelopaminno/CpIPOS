export function DataTable({ rows }: { rows: string[][] }) {
  if (!rows.length) return <p className="muted" style={{ padding: 16 }}>ไม่มีข้อมูล</p>;

  const [header = [], ...body] = rows;
  return (
    <div className="tableScroller">
      <table className="dataTable">
        <thead>
          <tr>
            {header.map((cell, index) => <th key={`${cell}-${index}`}>{cell || `คอลัมน์ ${index + 1}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {body.filter((row) => row.some(Boolean)).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] ?? ""}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
