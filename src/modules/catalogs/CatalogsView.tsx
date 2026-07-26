import { useMemo, useState } from 'react';
import { useCollection } from '../../hooks/useCollection';
import { createDocument, deleteDocument, updateDocument } from '../../services/firestore';
import type { BaseDoc } from '../../types/models';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Toolbar } from '../../components/ui/Toolbar';
import { Modal } from '../../components/ui/Modal';
import { FormField, FormGrid } from '../../components/ui/FormField';
import { DataPortButtons } from '../../components/ui/DataPortButtons';
import type { EntitySchema } from '../../config/entitySchemas';
import { CATALOG_DEFS, type CatalogDef } from './catalogConfig';
import './CatalogsView.css';

type CatalogDoc = BaseDoc & Record<string, unknown>;

export function CatalogsView() {
  const [def, setDef] = useState<CatalogDef>(CATALOG_DEFS[0]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CatalogDoc | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data, loading } = useCollection<CatalogDoc>(def.collection);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const sorted = [...data].sort((a, b) =>
      String(a[def.nameField] ?? '').localeCompare(String(b[def.nameField] ?? '')),
    );
    if (!term) return sorted;
    return sorted.filter((row) =>
      [def.nameField, ...def.extraFields.map((f) => f.key)].some((key) =>
        String(row[key] ?? '').toLowerCase().includes(term),
      ),
    );
  }, [data, search, def]);

  /** El catalogo activo se traduce a un esquema para el template y la importacion. */
  const schema = useMemo<EntitySchema>(
    () => ({
      collection: def.collection,
      label: def.label,
      idField: def.idField,
      fields: [
        { key: def.nameField, type: 'text', width: 30 },
        ...def.extraFields.map((field) => ({ key: field.key, type: 'text' as const, width: 26 })),
      ],
    }),
    [def],
  );

  const openCreate = () => {
    setEditing(null);
    setDraft({});
    setFormOpen(true);
  };

  const openEdit = (row: CatalogDoc) => {
    setEditing(row);
    const values: Record<string, string> = { [def.nameField]: String(row[def.nameField] ?? '') };
    for (const field of def.extraFields) values[field.key] = String(row[field.key] ?? '');
    setDraft(values);
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!draft[def.nameField]?.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, string> = { [def.nameField]: draft[def.nameField].trim() };
      for (const field of def.extraFields) payload[field.key] = (draft[field.key] ?? '').trim();
      if (editing) {
        await updateDocument(def.collection, editing.id, payload);
      } else {
        await createDocument<CatalogDoc>(def.collection, payload as Omit<CatalogDoc, 'id'>);
      }
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm(`Delete "${String(editing[def.nameField] ?? '')}"?`)) return;
    await deleteDocument(def.collection, editing.id);
    setFormOpen(false);
  };

  const columns: Array<Column<CatalogDoc>> = [
    { key: def.nameField, header: def.nameLabel, render: (row) => String(row[def.nameField] ?? '') },
    ...def.extraFields.map<Column<CatalogDoc>>((field) => ({
      key: field.key,
      header: field.label,
      render: (row) => String(row[field.key] ?? '') || '—',
    })),
  ];

  return (
    <div className="catalogs">
      <nav className="catalogs__menu" aria-label="Catalogs">
        {CATALOG_DEFS.map((item) => (
          <button
            key={item.collection}
            type="button"
            className={`catalogs__menu-item${item.collection === def.collection ? ' catalogs__menu-item--active' : ''}`}
            onClick={() => {
              setDef(item);
              setSearch('');
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <section className="catalogs__panel">
        <Toolbar
          title={def.label}
          subtitle={`${rows.length} records · ${def.collection}`}
          searchValue={search}
          onSearchChange={setSearch}
        >
          <DataPortButtons schemas={[schema]} fileName={def.collection.toLowerCase()} />
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ Add</button>
        </Toolbar>
        <DataTable columns={columns} rows={rows} loading={loading} onRowClick={openEdit} />
      </section>

      <Modal
        title={editing ? `Edit ${def.label.toLowerCase()}` : `New ${def.label.toLowerCase()}`}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            {editing && (
              <button type="button" className="btn btn--danger" onClick={() => void handleDelete()}>Delete</button>
            )}
            <button type="button" className="btn btn--secondary" onClick={() => setFormOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={saving || !draft[def.nameField]?.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <FormGrid>
          <FormField label={def.nameLabel} span2>
            <input
              className="input"
              value={draft[def.nameField] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [def.nameField]: e.target.value }))}
            />
          </FormField>
          {def.extraFields.map((field) => (
            <FormField key={field.key} label={field.label}>
              <input
                className="input"
                value={draft[field.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
              />
            </FormField>
          ))}
        </FormGrid>
      </Modal>
    </div>
  );
}
