import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpDown,
  Edit2,
  PackageCheck,
  PackagePlus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { saveData } from "../db/database";

const categories = ["Analgesics", "First Aid", "Supplies", "Respiratory", "Antibiotics", "Vitamins", "Emergency"];
const units = ["tablets", "pieces", "packs", "sachets", "inhalers", "bottles", "boxes", "ml"];

export default function Inventory({ data, setData }) {
  const [query, setQuery] = useState("");
  const [sortAscending, setSortAscending] = useState(true);
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("10");
  const [restockReason, setRestockReason] = useState("Routine restock");
  const [editingItem, setEditingItem] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    category: "First Aid",
    quantity: "0",
    unit: "pieces",
    expiryDate: "",
    reorderLevel: "10"
  });
  const low = data.inventory.filter(
    (item) => item.quantity <= item.reorderLevel,
  );
  const items = data.inventory.filter((item) =>
    `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((first, second) => sortAscending ? first.name.localeCompare(second.name) : second.name.localeCompare(first.name));
  
  // Calculate unique categories
  const uniqueCategories = new Set(data.inventory.map(item => item.category)).size || 0;
  
  // Calculate inventory value - showing "Not tracked" since we don't have pricing
  // In a real system, you'd add a 'price' field to inventory items
  const inventoryValue = data.inventory.length === 0 ? '₱0' : 'Not tracked';
  
  const adjust = (id, amount) => {
    try {
      setData(saveData({
        ...data,
        inventory: data.inventory.map((item) =>
          item.id === id
            ? { ...item, quantity: Math.max(0, item.quantity + amount) }
            : item,
        ),
      }));
      setActionError("");
    } catch (error) {
      console.error("Failed to adjust inventory quantity:", error);
      setActionError("Unable to update stock. Please try again.");
    }
  };

  const openRestock = (item = low[0] || data.inventory[0]) => {
    if (!item) {
      // If no inventory items exist, open the add form instead
      openAddForm();
      return;
    }
    setRestockItem(item);
    setRestockQuantity(String(Math.max(1, item.reorderLevel - item.quantity + 1)));
    setRestockReason("Routine restock");
  };

  const restock = (event) => {
    event.preventDefault();
    const quantity = Number(restockQuantity);
    if (!restockItem || !Number.isFinite(quantity) || quantity <= 0) {
      setActionError("Enter a quantity greater than zero.");
      return;
    }
    const next = {
      ...data,
      inventory: data.inventory.map((item) => item.id === restockItem.id ? { ...item, quantity: item.quantity + quantity } : item),
      stockAdjustments: [...(data.stockAdjustments || []), { id: Date.now(), medicineId: restockItem.id, medicineName: restockItem.name, quantity, reason: restockReason, date: new Date().toISOString() }],
    };
    try {
      setData(saveData(next));
      setRestockItem(null);
      setActionError("");
    } catch (error) {
      console.error("Failed to restock inventory item:", error);
      setActionError("Unable to save the restock. Please try again.");
    }
  };

  const openAddForm = () => {
    setFormData({
      name: "",
      category: "First Aid",
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
      quantity: String(item.quantity),
      unit: item.unit,
      expiryDate: item.expiryDate,
      reorderLevel: String(item.reorderLevel)
    });
    setEditingItem(item);
    setShowAddForm(true);
  };

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const quantity = Number(formData.quantity);
    const reorderLevel = Number(formData.reorderLevel);
    if (!formData.name.trim()) {
      setFormError("Item name is required.");
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      setFormError("Quantity must be a whole number of zero or more.");
      return;
    }
    if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
      setFormError("Reorder level must be a whole number of zero or more.");
      return;
    }

    const itemData = {
      name: formData.name.trim(),
      category: formData.category,
      quantity,
      unit: formData.unit,
      expiryDate: formData.expiryDate,
      reorderLevel,
    };

    try {
      if (editingItem) {
        setData(saveData({
          ...data,
          inventory: data.inventory.map(item =>
            item.id === editingItem.id ? { ...item, ...itemData } : item
          )
        }));
      } else {
        setData(saveData({
          ...data,
          inventory: [...data.inventory, { id: Date.now(), ...itemData }]
        }));
      }
      setFormError("");
      setShowAddForm(false);
      setEditingItem(null);
    } catch (error) {
      console.error("Failed to save inventory item:", error);
      setFormError("Unable to save this item. Please try again.");
    }
  };

  const deleteItem = (item) => {
    if (!confirm(`Are you sure you want to delete "${item.name}"? This action cannot be undone.`)) {
      return;
    }

    const next = {
      ...data,
      inventory: data.inventory.filter(i => i.id !== item.id)
    };
    try {
      setData(saveData(next));
    } catch (error) {
      console.error("Failed to delete inventory item:", error);
      setActionError("Unable to delete this item. Please try again.");
    }
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Stock control</p>
          <h2>
            Inventory{" "}
            <span className="soft-count">{data.inventory.length} items</span>
          </h2>
          <p>Know what is available before the next student arrives.</p>
        </div>
        <button className="primary-btn" onClick={openAddForm}>
          <PackagePlus size={16} /> Add item
        </button>
      </div>
      <div className="inventory-summary">
        <div>
          <span>Total items</span>
          <strong>{data.inventory.length}</strong>
          <small>{uniqueCategories} {uniqueCategories === 1 ? 'category' : 'categories'}</small>
        </div>
        <div>
          <span>Low stock</span>
          <strong className="rose-text">{low.length}</strong>
          <small>{low.length === 0 ? 'All stocked' : 'Needs attention'}</small>
        </div>
        <div>
          <span>Inventory value</span>
          <strong>{inventoryValue}</strong>
          <small>Current estimate</small>
        </div>
      </div>
      {actionError && <div className="error-banner" role="alert">{actionError}</div>}
      {low.length > 0 && (
        <div className="stock-alert">
          <TriangleAlert size={18} />
          <div>
            <strong>{low.length} items need restocking</strong>
            <p>{low.map((item) => item.name).join(" · ")}</p>
          </div>
        </div>
      )}
      <section className="panel table-panel inventory-table">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Current stock</p>
            <h3>Medicine & supplies</h3>
          </div>
          <div className="toolbar-inline">
            <div className="search-box compact">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search inventory..."
              />
            </div>
            <button className="filter-btn" onClick={() => setSortAscending((value) => !value)}>
              <ArrowUpDown size={15} /> Sort
            </button>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
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
                <td colSpan="6" className="empty-state">
                  {query ? "No inventory items match your search." : "No inventory items yet. Add an item to begin tracking stock."}
                </td>
              </tr>
            ) : items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name}</strong>
                  <small>
                    Reorder at {item.reorderLevel} {item.unit}
                  </small>
                </td>
                <td>{item.category}</td>
                <td>
                  <strong>{item.quantity}</strong> {item.unit}
                </td>
                <td>{item.expiryDate}</td>
                <td>
                  <span
                    className={`status-chip ${item.quantity <= item.reorderLevel ? "warn" : "success"}`}
                  >
                    {item.quantity <= item.reorderLevel
                      ? "Low stock"
                      : "In stock"}
                  </span>
                </td>
                <td>
                  <div className="adjust-actions">
                    <button aria-label={`Remove one ${item.unit} from ${item.name}`} onClick={() => adjust(item.id, -1)} title="Remove one unit">
                      <ArrowDownToLine size={13} />
                    </button>
                    <button aria-label={`Add one ${item.unit} to ${item.name}`} onClick={() => adjust(item.id, 1)} title="Add one unit">
                      <PackagePlus size={13} />
                    </button>
                    <button className="icon-btn-small" aria-label={`Restock ${item.name}`} onClick={() => openRestock(item)} title="Restock item"><PackageCheck size={13} /></button>
                    <button className="icon-btn-small" aria-label={`Edit ${item.name}`} onClick={() => openEditForm(item)} title="Edit item">
                      <Edit2 size={13} />
                    </button>
                    <button className="icon-btn-small danger" aria-label={`Delete ${item.name}`} onClick={() => deleteItem(item)} title="Delete item">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {restockItem && <div className="modal-backdrop" role="presentation" onClick={() => setRestockItem(null)}><form className="modal-card" onSubmit={restock} onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="section-kicker">Stock adjustment</p><h3>Restock item</h3></div><button type="button" className="icon-btn" onClick={() => setRestockItem(null)} aria-label="Close restock dialog"><X size={18}/></button></div><div className="restock-item-preview"><PackagePlus size={18}/><div><strong>{restockItem.name}</strong><span>{restockItem.quantity} {restockItem.unit} currently on hand</span></div></div><label>Quantity received<input type="number" min="1" value={restockQuantity} onChange={(event) => setRestockQuantity(event.target.value)} required /></label><label>Reason<select value={restockReason} onChange={(event) => setRestockReason(event.target.value)}><option>Routine restock</option><option>Emergency purchase</option><option>Donation</option><option>Stock correction</option></select></label><div className="form-actions"><button type="button" className="secondary-btn" onClick={() => setRestockItem(null)}>Cancel</button><button type="submit" className="primary-btn"><PackagePlus size={16}/> Confirm restock</button></div></form></div>}

      {showAddForm && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowAddForm(false)}>
          <form className="modal-card" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="section-kicker">Inventory management</p>
                <h3>{editingItem ? 'Edit item' : 'Add new item'}</h3>
              </div>
              <button type="button" className="icon-btn" onClick={() => setShowAddForm(false)} aria-label="Close form">
                <X size={18} />
              </button>
            </div>

            {formError && <div className="error-banner" role="alert">{formError}</div>}

            <div className="form-grid">
              <label>
                Item name *
                <input 
                  type="text" 
                  value={formData.name}
                  onChange={(e) => handleFormChange('name', e.target.value)}
                  placeholder="e.g., Paracetamol 500mg"
                  required 
                />
              </label>

              <label>
                Category *
                <select 
                  value={formData.category}
                  onChange={(e) => handleFormChange('category', e.target.value)}
                  required
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </label>

              <label>
                Quantity *
                <input 
                  type="number" 
                  min="0"
                  value={formData.quantity}
                  onChange={(e) => handleFormChange('quantity', e.target.value)}
                  required 
                />
              </label>

              <label>
                Unit *
                <select 
                  value={formData.unit}
                  onChange={(e) => handleFormChange('unit', e.target.value)}
                  required
                >
                  {units.map(unit => (
                    <option key={unit} value={unit}>{unit}</option>
                  ))}
                </select>
              </label>

              <label>
                Expiry date *
                <input 
                  type="date"
                  value={formData.expiryDate}
                  onChange={(e) => handleFormChange('expiryDate', e.target.value)}
                  required 
                />
              </label>

              <label>
                Reorder level *
                <input 
                  type="number" 
                  min="0"
                  value={formData.reorderLevel}
                  onChange={(e) => handleFormChange('reorderLevel', e.target.value)}
                  required 
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setShowAddForm(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-btn">
                <PackagePlus size={16} />
                {editingItem ? 'Update item' : 'Add item'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
