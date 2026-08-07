import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppConfig } from '../../context/AppConfigContext';
import { useCollection } from '../../hooks/useCollection';
import { MODULE_DEFS } from '../../config/modules';
import { COLLECTIONS, type FormFieldConfig, type SystemUser } from '../../types/models';
import { SearchableSelect } from '../../components/ui/SearchableSelect';
import { Toolbar } from '../../components/ui/Toolbar';
import './ConfigView.css';

/** Formularios configurables y sus campos por defecto (clave = etiqueta en codigo). */
const FORM_DEFS: { id: string; label: string; fields: string[] }[] = [
  {
    id: 'purchases',
    label: 'Purchase order form',
    fields: ['Lot #', 'Grower / Origin', 'Vendor', 'Ship to', 'Buyer', 'Note', 'Commission %', '# Ref', 'Carrier', 'Arrival date'],
  },
  {
    id: 'sales',
    label: 'Sales order form',
    fields: ['# Sales order', 'Status', 'Date', 'Due date', 'Customer', 'Buyer', 'Salesperson', 'Supplier', 'Ref', 'Ref pickup', 'Pick up #', 'OD day', 'Address', 'City / State / ZIP', 'Carrier', 'Ship via', 'Shipping terms', 'Temp log', 'Description', 'Sent'],
  },
  {
    id: 'expenses',
    label: 'Expense form',
    fields: ['# Lot (purchase order)', 'Supplier', 'Category', 'Invoice #', 'Date', 'Amount', 'Check #', 'Photo check (URL)', 'Deduct', 'Note'],
  },
];

type Section = 'nav' | 'viewas' | string;

export function ConfigView() {
  const { canAdmin, viewAsProfile, setViewAs } = useAuth();
  const { sortNav, saveNavOrder, fieldsFor, saveFormFields } = useAppConfig();
  const { data: systemUsers } = useCollection<SystemUser>(COLLECTIONS.SYSTEM_USERS);

  const canNav = canAdmin('navOrder');
  const canLabels = canAdmin('formLabels');
  const canOrder = canAdmin('formOrder');
  const canRequired = canAdmin('requiredFields');
  const canViewAs = canAdmin('viewAs');
  const canForms = canLabels || canOrder || canRequired;

  const sections = useMemo(() => {
    const list: { id: Section; label: string }[] = [];
    if (canNav) list.push({ id: 'nav', label: 'Navigation menu' });
    if (canForms) for (const form of FORM_DEFS) list.push({ id: form.id, label: form.label });
    if (canViewAs) list.push({ id: 'viewas', label: 'View as user' });
    return list;
  }, [canNav, canForms, canViewAs]);

  const [section, setSection] = useState<Section>(sections[0]?.id ?? 'nav');
  useEffect(() => {
    if (sections.length > 0 && !sections.some((s) => s.id === section)) setSection(sections[0].id);
  }, [sections, section]);

  /* ---- Navegacion ---- */
  const navItems = useMemo(
    () => sortNav(MODULE_DEFS.map((m) => ({ key: m.id, label: m.label }))),
    [sortNav],
  );
  const [navDraft, setNavDraft] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => setNavDraft(navItems), [navItems]);

  const moveNav = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= navDraft.length) return;
    const next = [...navDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setNavDraft(next);
  };

  /* ---- Campos de formularios ---- */
  const formDef = FORM_DEFS.find((f) => f.id === section) ?? null;
  const [fieldsDraft, setFieldsDraft] = useState<FormFieldConfig[]>([]);
  useEffect(() => {
    if (formDef) setFieldsDraft(fieldsFor(formDef.id, formDef.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const moveField = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fieldsDraft.length) return;
    const next = [...fieldsDraft];
    [next[index], next[target]] = [next[target], next[index]];
    setFieldsDraft(next);
  };

  const patchField = (index: number, patch: Partial<FormFieldConfig>) => {
    setFieldsDraft((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  /* ---- View as ---- */
  const userOptions = useMemo(
    () =>
      [...systemUsers]
        .map((u) => ({ id: u.id, name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [systemUsers],
  );
  const [viewAsDraft, setViewAsDraft] = useState('');

  if (sections.length === 0) {
    return (
      <div className="config">
        <Toolbar title="Configurator" />
        <p className="config__no-access">Your role has no configurator capabilities. Ask an administrator.</p>
      </div>
    );
  }

  return (
    <div className="config">
      <Toolbar title="Configurator" subtitle="Navigation, forms and impersonation" />

      <div className="config__layout">
        <nav className="config__sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`config__section-btn${section === s.id ? ' config__section-btn--active' : ''}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="config__content">
          {section === 'nav' && canNav && (
            <div className="config__card">
              <h3 className="config__card-title">Navigation menu order</h3>
              <p className="config__hint">
                This is the order of the sidebar for every user. Each person still only sees the
                modules their role allows.
              </p>
              <ul className="config__list">
                {navDraft.map((item, index) => (
                  <li className="config__row" key={item.key}>
                    <span className="config__row-order">{index + 1}</span>
                    <span className="config__row-label">{item.label}</span>
                    <span className="config__row-actions">
                      <button type="button" className="config__arrow" disabled={index === 0} onClick={() => moveNav(index, -1)} aria-label="Move up">▲</button>
                      <button type="button" className="config__arrow" disabled={index === navDraft.length - 1} onClick={() => moveNav(index, 1)} aria-label="Move down">▼</button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="config__actions">
                <button type="button" className="btn btn--primary" onClick={() => saveNavOrder(navDraft.map((i) => i.key))}>
                  Save order
                </button>
              </div>
            </div>
          )}

          {formDef && canForms && (
            <div className="config__card">
              <h3 className="config__card-title">{formDef.label}</h3>
              <p className="config__hint">
                The order here is the order of the fields in the form — both when creating and when
                opening a row to edit. Renamed labels appear everywhere the field is shown.
              </p>
              <ul className="config__list">
                {fieldsDraft.map((field, index) => (
                  <li className="config__row" key={field.key}>
                    <span className="config__row-order">{index + 1}</span>
                    <span className="config__field-main">
                      <input
                        className="input config__field-label"
                        value={field.label}
                        disabled={!canLabels}
                        title={canLabels ? `Rename (default: ${field.key})` : 'Your role cannot rename fields'}
                        onChange={(e) => patchField(index, { label: e.target.value })}
                      />
                      {field.label !== field.key && <span className="config__field-default">default: {field.key}</span>}
                    </span>
                    <label className={`config__required${canRequired ? '' : ' config__required--locked'}`}>
                      <input
                        type="checkbox"
                        className="config__checkbox"
                        checked={field.required}
                        disabled={!canRequired}
                        onChange={(e) => patchField(index, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <span className="config__row-actions">
                      <button type="button" className="config__arrow" disabled={!canOrder || index === 0} onClick={() => moveField(index, -1)} aria-label="Move up">▲</button>
                      <button type="button" className="config__arrow" disabled={!canOrder || index === fieldsDraft.length - 1} onClick={() => moveField(index, 1)} aria-label="Move down">▼</button>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="config__actions">
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => setFieldsDraft(formDef.fields.map((key) => ({ key, label: key, required: false })))}
                >
                  Reset to defaults
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => saveFormFields(formDef.id, fieldsDraft.map((f) => ({ ...f, label: f.label.trim() || f.key })))}
                >
                  Save fields
                </button>
              </div>
            </div>
          )}

          {section === 'viewas' && canViewAs && (
            <div className="config__card">
              <h3 className="config__card-title">View as another user</h3>
              <p className="config__hint">
                See the app exactly as another user sees it — same menu, same buttons, same limits.
                While active, a banner at the top lets you exit at any time.
              </p>
              {viewAsProfile ? (
                <div className="config__viewas-active">
                  <span>
                    Currently viewing as <strong>{`${viewAsProfile.firstName ?? ''} ${viewAsProfile.lastName ?? ''}`.trim() || viewAsProfile.email}</strong>
                  </span>
                  <button type="button" className="btn btn--secondary" onClick={() => setViewAs(null)}>
                    Exit view
                  </button>
                </div>
              ) : (
                <div className="config__viewas-picker">
                  <SearchableSelect
                    value={viewAsDraft}
                    onChange={setViewAsDraft}
                    options={userOptions}
                    placeholder="Search a user…"
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!viewAsDraft}
                    onClick={() => setViewAs(viewAsDraft)}
                  >
                    Start viewing
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
