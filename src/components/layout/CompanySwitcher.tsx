import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../hooks/useCollection';
import { COLLECTIONS, type Company } from '../../types/models';
import './CompanySwitcher.css';

/**
 * Selector de empresa del topbar: solo lo ve el administrador de la plataforma.
 * Cambiar de empresa recarga la app para no dejar datos de la anterior en memoria.
 */
export function CompanySwitcher() {
  const { companyId, switchCompany } = useAuth();
  const { data: companies } = useCollection<Company>(COLLECTIONS.COMPANIES);

  if (companies.length === 0) return null;

  return (
    <label className="company-switch" title="Active company">
      <span className="company-switch__label">Company</span>
      <select
        className="company-switch__select"
        value={companyId}
        onChange={(e) => switchCompany(e.target.value)}
      >
        <option value="">Select a company…</option>
        {[...companies]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
      </select>
    </label>
  );
}
