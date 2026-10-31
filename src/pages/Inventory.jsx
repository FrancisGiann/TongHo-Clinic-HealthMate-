import useConfirmation from "../hooks/useConfirmation";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowDownToLine,
  Edit2,
  PackageCheck,
  PackagePlus,
  Search,
  TriangleAlert,
  RotateCcw,
} from "lucide-react";
import { api } from "../utils/api";
import ModalDialog from "../components/ModalDialog";
import { compareValues, readListState, sortAndPaginate, updateListParams } from "../utils/listState.js";
import ListPagination from "../components/ListPagination.jsx";
import "./Inventory.css";

const categories = ["Analgesics", "First Aid", "Supplies", "Respiratory", "Antibiotics", "Vitamins", "Emergency"];
const units = ["tablets", "pieces", "packs", "sachets", "inhalers", "bottles", "boxes", "ml"];

export default function Inventory({ data, applyServerData, reload, saving = false }) {
  const { confirmAction, confirmationDialog } = useConfirmation();
  const [searchParams, setSearchParams] = useSearchParams();
  const list = readListState(searchParams, { sort: 'name', order: 'asc', pageSize: 25 });
  const filterOptions = ['medications', 'supplies', 'unclassified', 'archived'];
  const filter = filterOptions.includes(searchParams.get('filter')) ? searchParams.get('filter') : 'all';
  const showArchived = filter === 'archived';
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("10");
  const [restockReason, setRestockReason] = useState("Routine restock");
  const [editingItem, setEditingItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const actionLock = useRef(false);
  const [formData, setFormData] = useState({
    name: "",
    category: "First Aid",
    itemType: "",
    quantity: "0",
    unit: "pieces",
    expiryDate: "",
    reorderLevel: "10"
  });
  const inventory = data.inventory || [];
  const activeInventory = inventory.filter((item) => !item.archived);
  const low = activeInventory.filter(
    (item) => item.quantity <= item.reorderLevel,
  );
  const matchingItems = inventory.filter((item) => (showArchived ? Boolean(item.archived) : !item.archived)
    && (filter !== 'medications' || item.itemType === 'medication')
    && (filter !== 'supplies' || item.itemType === 'supply')
    && (filter !== 'unclassified' || !['medication', 'supply'].includes(item.itemType))
    && `${item.name} ${item.category}`.toLowerCase().includes(list.q.toLowerCase()));
  const pageResult = sortAndPaginate(matchingItems, (first, second, order) => {
    if (list.sort === 'quantity') return compareValues(Number.isFinite(Number(first.quantity)) ? Number(first.quantity) : null, Number.isFinite(Number(second.quantity)) ? Number(second.quantity) : null, order);
    if (list.sort === 'expiry') return compareValues(first.expiryDate || null, second.expiryDate || null, order);
    return compareValues(first.name, second.name, order);
  }, list);
  const items = pageResult.items;
  const setListValue = (key, value, resetPage = true) => updateListParams(searchParams, setSearchParams, { [key]: value }, { resetPage });
  useEffect(() => {
    if (list.page !== pageResult.page) setListValue('page', pageResult.page === 1 ? null : pageResult.page, false);
  }, [list.page, pageResult.page]);
  
  // Calculate unique categories
  const uniqueCategories = new Set(activeInventory.map(item => item.category)).size || 0;
  const unclassifiedItems = activeInventory.filter((item) => !['medication', 'supply'].includes(item.itemType)).length;

  const runInventoryRequest = async (request, onError = setActionError) => {
    if (actionLock.current || saving) return false;
    actionLock.current = true;
    setPendingAction(true);
    setActionError("");
    try {
      const state = await request();
      if (!applyServerData(state)) await reload();
      return true;
    } catch (error) {
      if (error.code === 'VERSION_CONFLICT') await reload().catch(() => {});
      onError(error.message || "Unable to save this inventory change. Please try again.");
      return false;
    } finally {
      actionLock.current = false;
      setPendingAction(false);
    }
  };

  const adjust = (id, amount) => runInventoryRequest(() => api.post(`/api/inventory/${encodeURIComponent(id)}/stock-adjustments`, {
    quantityDelta: amount,
    reason: 'Manual stock count adjustment',
    schemaVersion: data.schemaVersion,
  }));

  const openRestock = (item = low[0] || activeInventory[0]) => {
    if (!item) {
      // If no inventory items exist, open the add form instead
      openAddForm();
      return;
    }
    setRestockItem(item);
    setActionError("");
    setRestockQuantity(String(Math.max(1, item.reorderLevel - item.quantity + 1)));
    setRestockReason("Routine restock");
  };

  const restock = async (event) => {
    event.preventDefault();
    const quantity = Number(restockQuantity);
    if (!restockItem || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      setActionError("Enter a whole number from 1 to 1,000,000.");
      return;
    }
    const saved = await runInventoryRequest(() => api.post(`/api/inventory/${encodeURIComponent(restockItem.id)}/stock-adjustments`, {
      quantityDelta: quantity,
      reason: restockReason,
      schemaVersion: data.schemaVersion,
    }));
    if (saved) setRestockItem(null);
  };

  const openAddForm = () => {
    setFormData({
      name: "",
      category: "First Aid",
      itemType: "",
      quantity: "0",
      unit: "pieces",
      expiryDate: "",
      reorderLevel: "10"
    });
    setEditingItem(null);
    setFormError("");
    setShowAddForm(true);
  };

  const openEditForm = (item) => {
    setFormData({
      name: item.name,
      category: item.category,
      itemType: item.itemType || "",
      quantity: String(item.quantity),
      unit: item.unit,
      expiryDate: item.expiryDate,
      reorderLevel: String(item.reorderLevel)
    });
    setEditingItem(item);
    setFormError("");
    setShowAddForm(true);
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const quantity = Number(formData.quantity);
    const reorderLevel = Number(formData.reorderLevel);
    if (!formData.name.trim()) {
      setFormError("Item name is required.");
      return;
    }
    if (!editingItem && (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000)) {
      setFormError("Quantity must be a whole number of zero or more.");
      return;
    }
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > 1_000_000) {
      setFormError("Reorder level must be a whole number of zero or more.");
      return;
    }
    const isDuplicate = activeInventory.some((item) => item.name.toLowerCase() === formData.name.trim().toLowerCase() && item.id !== editingItem?.id);
    if (isDuplicate) {
      setFormError("An item with this name already exists.");
      return;
    }

    const itemData = {
      name: formData.name.trim(),
      category: formData.category,
      itemType: formData.itemType,
      unit: formData.unit,
      expiryDate: formData.expiryDate,
      reorderLevel,
      schemaVersion: data.schemaVersion,
    };

    const request = editingItem
      ? () => api.patch(`/api/inventory/${encodeURIComponent(editingItem.id)}`, itemData)
      : () => api.post('/api/inventory', { ...itemData, quantity });
    const saved = await runInventoryRequest(request, setFormError);
    if (saved) {
      setShowAddForm(false);
      setEditingItem(null);
      setFormError("");
    }
  };

  const setArchived = async (item, archived) => {
    if (archived && !await confirmAction({
      title: 'Archive inventory item?',
      message: `“${item.name}” will no longer be available for dispensing. You can restore it from Show archived.`,
      confirmLabel: 'Archive item',
    })) {
      return;
    }
    await runInventoryRequest(() => api.patch(`/api/inventory/${encodeURIComponent(item.id)}/archive`, {
      archived,
      schemaVersion: data.schemaVersion,
    }));
  };

  useEffect(() => {
    const requestedAdd = searchParams.get('add') === '1';
    const requestedArchived = searchParams.get('archived') === '1';
    const requestedEdit = searchParams.get('edit');
    const requestedRestock = searchParams.get('restock');
    const requestedEditItem = requestedEdit && inventory.find((item) => String(item.id) === requestedEdit && !item.archived);
    const requestedRestockItem = requestedRestock && inventory.find((item) => String(item.id) === requestedRestock && !item.archived);
    const hasInventoryAction = requestedAdd || requestedArchived || requestedEdit || requestedRestock;
    if (!hasInventoryAction) return;

    if (requestedAdd) openAddForm();
    else if (requestedEdit) {
      if (requestedEditItem) openEditForm(requestedEditItem);
      else setActionError('That inventory item is no longer available to edit. Refresh the inventory list and try again.');
    } else if (requestedRestock) {
      if (requestedRestockItem) openRestock(requestedRestockItem);
      else setActionError('That inventory item is no longer available to restock. Refresh the inventory list and try again.');
    }
    const nextParams = new URLSearchParams(searchParams);
    for (const key of ['add', 'archived', 'edit', 'restock']) nextParams.delete(key);
    if (requestedArchived) nextParams.set('filter', 'archived');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, inventory]);
  const editUrl = (id) => {
    const params = new URLSearchParams(searchParams);
    params.set('edit', String(id));
    return `/inventory?${params.toString()}`;
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Stock control</p>
          <h2>
            Inventory{" "}
            <span className="soft-count">{activeInventory.length} active</span>
          </h2>
          <p>Know what is available before the next student arrives.</p>
        </div>
        <button type="button" className="primary-btn" onClick={openAddForm} disabled={pendingAction || saving}>
          <PackagePlus size={16} /> Add item
        </button>
      </div>
      <div className="inventory-summary">
        <div>
          <span>Total items</span>
          <strong>{activeInventory.length}</strong>
          <small>{uniqueCategories} {uniqueCategories === 1 ? 'category' : 'categories'}</small>
        </div>
        <div>
          <span>Low stock</span>
          <strong className="rose-text">{low.length}</strong>
          <small>{low.length === 0 ? 'All stocked' : 'Needs attention'}</small>
        </div>
        <div>
          <span>Unclassified</span>
          <strong>{unclassifiedItems}</strong>
          <small>{unclassifiedItems ? 'Review item type before dispensing' : 'All items have a type'}</small>
        </div>
      </div>
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      {pendingAction && <p className="field-hint" role="status" aria-live="polite">Saving inventory changes…</p>}
      {low.length > 0 && (
        <div className="stock-alert" role="status">
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>{low.length} items need restocking</strong>
            <p>{low.map((item) => item.name).join(" · ")}</p>
          </div>
        </div>
      )}
      <section className="panel table-panel inventory-table">
        <div className="panel-heading inventory-list-heading">
          <div>
            <p className="section-kicker">Current stock</p>
            <h3>Medications & supplies</h3>
          </div>
          <div className="toolbar-inline">
            <label className="directory-filter inventory-search-filter">
              Search
              <span className="search-box compact inventory-search-control">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={list.q}
                  onChange={(e) => setListValue('q', e.target.value)}
                  placeholder="Search inventory..."
                  aria-label="Search inventory items"
                />
              </span>
            </label>
            <label className="directory-filter">Sort by<select value={list.sort} onChange={(event) => setListValue('sort', event.target.value)}><option value="name">Name</option><option value="quantity">Quantity</option><option value="expiry">Expiry date</option></select></label>
            <label className="directory-filter">Order<select value={list.order} onChange={(event) => setListValue('order', event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
          </div>
        </div>
        <div className="inventory-filter-tabs" role="group" aria-label="Inventory categories">
          {[['all', 'All active'], ['medications', 'Medications'], ['supplies', 'Supplies'], ['unclassified', 'Unclassified'], ['archived', 'Archived']].map(([value, label]) => <button type="button" key={value} className={`filter-btn${filter === value ? ' active' : ''}`} aria-pressed={filter === value} onClick={() => setListValue('filter', value === 'all' ? null : value)}>{label}</button>)}
        </div>
        <p className="field-hint" aria-live="polite">Showing {pageResult.total} inventory {pageResult.total === 1 ? 'item' : 'items'}.</p>
        <table aria-label="Inventory items and stock actions">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Category</th>
              <th>On hand</th>
              <th>Expiry</th>
              <th>Stock level</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  {list.q ? "No inventory items match your search." : showArchived ? "No archived items match this view." : filter !== 'all' ? "No active items match this category." : "No active inventory items yet. Add an item to begin tracking stock."}
                </td>
              </tr>
            ) : items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small>
                    Reorder at {item.reorderLevel} {item.unit}
                  </small>
                  {!item.archived && !['medication', 'supply'].includes(item.itemType) && <small className="inventory-type-review"><Link to={editUrl(item.id)}>Review item type</Link></small>}
                </td>
                <td>{item.itemType
                  ? <span className="status-chip neutral">{item.itemType === 'medication' ? 'Medication' : 'Supply'}</span>
                  : <span className="status-chip warn">Unclassified</span>}</td>
                <td>{item.category}</td>
                <td>
                  <strong>{item.quantity}</strong> {item.unit}
                </td>
                <td>{item.expiryDate}</td>
                <td>
                  {item.archived
                    ? <span className="status-chip neutral">Archived</span>
                    : <span className={`status-chip ${item.quantity <= item.reorderLevel ? "warn" : "success"}`}>
                      {item.quantity <= item.reorderLevel ? "Low stock" : "In stock"}
                    </span>}
                </td>
                <td>
                  <div className="adjust-actions">
                    {item.archived ? (
                      <button type="button" className="icon-btn-small" aria-label={`Restore ${item.name}`} onClick={() => setArchived(item, false)} disabled={pendingAction || saving} title="Restore item">
                        <RotateCcw size={13} />
                      </button>
                    ) : <>
                      <button type="button" aria-label={`Remove one ${item.unit} from ${item.name}`} onClick={() => adjust(item.id, -1)} disabled={pendingAction || saving || item.quantity <= 0} title="Remove one unit">
                        <ArrowDownToLine size={13} />
                      </button>
                      <button type="button" aria-label={`Add one ${item.unit} to ${item.name}`} onClick={() => adjust(item.id, 1)} disabled={pendingAction || saving || item.quantity >= 1_000_000} title="Add one unit">
                        <PackagePlus size={13} />
                      </button>
                      <button type="button" className="icon-btn-small" aria-label={`Restock ${item.name}`} onClick={() => openRestock(item)} disabled={pendingAction || saving} title="Restock item"><PackageCheck size={13} /></button>
                      <button type="button" className="icon-btn-small" aria-label={`Edit ${item.name}`} onClick={() => openEditForm(item)} disabled={pendingAction || saving} title="Edit item">
                        <Edit2 size={13} />
                      </button>
                      <button type="button" className="icon-btn-small danger" aria-label={`Archive ${item.name}`} onClick={() => setArchived(item, true)} disabled={pendingAction || saving} title="Archive item">
                        <Archive size={13} />
                      </button>
                    </>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ListPagination page={pageResult.page} pageCount={pageResult.pageCount} pageSize={pageResult.pageSize} total={pageResult.total}
          onPageChange={(page) => setListValue('page', page === 1 ? null : page, false)} onPageSizeChange={(pageSize) => updateListParams(searchParams, setSearchParams, { pageSize, page: null }, { resetPage: true })} />
      </section>
      <ModalDialog open={Boolean(restockItem)} title="Restock item" eyebrow="Stock adjustment" onClose={() => setRestockItem(null)} busy={pendingAction}>
        {restockItem && <form onSubmit={restock}>
          <div className="restock-item-preview"><PackagePlus size={18} aria-hidden="true"/><div><strong>{restockItem.name}</strong><span>{restockItem.quantity} {restockItem.unit} currently on hand</span></div></div>
          {actionError && <div className="error-banner" role="alert">{actionError}</div>}
          {pendingAction && <p className="field-hint" role="status" aria-live="polite">Saving stock adjustment…</p>}
          <label>Quantity received<input type="number" min="1" max="1000000" step="1" value={restockQuantity} onChange={(event) => setRestockQuantity(event.target.value)} required disabled={pendingAction} autoFocus /></label>
          <label>Reason<select value={restockReason} onChange={(event) => setRestockReason(event.target.value)} disabled={pendingAction}><option>Routine restock</option><option>Emergency purchase</option><option>Donation</option><option>Stock correction</option></select></label>
          <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => setRestockItem(null)} disabled={pendingAction}>Cancel</button><button type="submit" className="primary-btn" disabled={pendingAction || saving}><PackagePlus size={16}/> {pendingAction ? 'Saving…' : 'Confirm restock'}</button></div>
        </form>}
      </ModalDialog>

      <ModalDialog open={showAddForm} title={editingItem ? 'Edit item' : 'Add new item'} eyebrow="Inventory management" onClose={() => setShowAddForm(false)} busy={pendingAction || saving} className="inventory-item-dialog">
          <form onSubmit={handleSubmit}>
            {formError && <div className="error-banner" role="alert">{formError}</div>}

            <div className="form-grid">
              <label>
                Item name *
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  placeholder="e.g., Paracetamol 500mg"
                  maxLength={120}
                  required 
                  disabled={pendingAction}
                  autoFocus
                />
              </label>

              <label>
                Item type *
                <select
                  value={formData.itemType}
                  onChange={(e) => handleFormChange('itemType', e.target.value)}
                  required
                  disabled={pendingAction}
                >
                  <option value="">Select item type</option>
                  <option value="medication">Medication</option>
                  <option value="supply">Supply</option>
                </select>
                {!formData.itemType && editingItem && <small className="field-hint">This legacy item remains unclassified until a nurse reviews it.</small>}
              </label>

              <label>
                Category *
                <select 
                  value={formData.category}
                  onChange={(e) => handleFormChange('category', e.target.value)}
                  required
                  disabled={pendingAction}
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </label>

              {!editingItem && <label>
                Starting stock *
                <input type="number" min="0" max="1000000" step="1" value={formData.quantity} onChange={(e) => handleFormChange('quantity', e.target.value)} required disabled={pendingAction} />
              </label>}

              <label>
                Unit *
                <select 
                  value={formData.unit}
                  onChange={(e) => handleFormChange('unit', e.target.value)}
                  required
                  disabled={pendingAction}
                >
                  {units.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </label>

              <label>
                Expiry date (optional)
                <input 
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => handleFormChange('expiryDate', e.target.value)}
                  disabled={pendingAction}
                />
                <small className="field-hint">Leave blank if the item does not expire.</small>
              </label>

              <label>
                Reorder level *
                <input 
                  type="number" 
                  min="0"
                  max="1000000"
                  step="1"
                  value={formData.reorderLevel}
                  onChange={(e) => handleFormChange('reorderLevel', e.target.value)}
                  required 
                  disabled={pendingAction}
                />
              </label>
              {editingItem && <p className="field-hint" role="note">Current stock: {editingItem.quantity} {editingItem.unit}. Use stock adjustment controls to change it.</p>}
            </div>

            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setShowAddForm(false)} disabled={pendingAction}>
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={pendingAction || saving}>
                <PackagePlus size={16} />
                {pendingAction ? 'Saving…' : editingItem ? 'Update item' : 'Add item'}
              </button>
            </div>
          </form>
      </ModalDialog>
      {confirmationDialog}
    </div>
  );
}
