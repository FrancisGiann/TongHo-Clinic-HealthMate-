import './ContextDialogs.css';
export default function ListPagination({ page, pageCount, pageSize, total, onPageChange, onPageSizeChange }) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return <div className="list-pagination" aria-label="List pagination">
    <p>Showing {start}–{end} of {total}</p>
    <label className="list-page-size"><span>Rows per page</span><select aria-label="Rows per page" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
      {[10, 25, 50].map((size) => <option value={size} key={size}>{size}</option>)}
    </select></label>
    <div className="list-pagination-actions">
      <button type="button" className="secondary-btn" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" className="secondary-btn" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>Next</button>
    </div>
  </div>;
}
