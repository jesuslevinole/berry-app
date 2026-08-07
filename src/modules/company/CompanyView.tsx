import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../hooks/useCompany';
import { Toolbar } from '../../components/ui/Toolbar';
import type { CompanyBank } from '../../types/models';
import './CompanyView.css';

const MAX_LOGO_BYTES = 400 * 1024;

const emptyBank = (): CompanyBank => ({
  id: crypto.randomUUID(),
  bankName: '',
  address: '',
  routing: '',
  account: '',
});

export function CompanyView() {
  const { can } = useAuth();
  const { company, loading, save } = useCompany();
  const canEdit = can('company', 'edit');

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [cityStateZip, setCityStateZip] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [logo, setLogo] = useState('');
  const [banks, setBanks] = useState<CompanyBank[]>([]);

  useEffect(() => {
    if (loading) return;
    setName(company.name);
    setAddress(company.address);
    setCityStateZip(company.cityStateZip);
    setPhone(company.phone);
    setEmail(company.email);
    setLogo(company.logo);
    setBanks(company.banks ?? []);
  }, [company, loading]);

  const handleLogoFile = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      alert('Logo too large. Please use an image under 400 KB (PNG or JPG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  };

  const patchBank = (id: string, patch: Partial<CompanyBank>) => {
    setBanks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const handleSave = () => {
    if (!name.trim()) {
      alert('Company name is required.');
      return;
    }
    const cleanBanks = banks
      .map((b) => ({ ...b, bankName: b.bankName.trim(), routing: b.routing.trim(), account: b.account.trim() }))
      .filter((b) => b.bankName || b.routing || b.account);
    save({
      name: name.trim(),
      address: address.trim(),
      cityStateZip: cityStateZip.trim(),
      phone: phone.trim(),
      email: email.trim(),
      logo,
      banks: cleanBanks,
    });
    alert('Company information saved.');
  };

  return (
    <div className="company">
      <Toolbar title="Company Info" subtitle="Logo, contact details and bank accounts">
        {canEdit && (
          <button type="button" className="btn btn--primary" onClick={handleSave}>Save changes</button>
        )}
      </Toolbar>

      <div className="company__grid">
        <section className="company__card">
          <h3 className="company__card-title">Identity</h3>

          <div className="company__logo-row">
            <div className="company__logo-box">
              {logo ? (
                <img className="company__logo" src={logo} alt="Company logo" />
              ) : (
                <span className="company__logo-placeholder">No logo</span>
              )}
            </div>
            {canEdit && (
              <div className="company__logo-actions">
                <label className="btn btn--secondary company__upload">
                  Upload logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="company__file"
                    onChange={(e) => handleLogoFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {logo && (
                  <button type="button" className="btn btn--secondary" onClick={() => setLogo('')}>Remove</button>
                )}
                <p className="company__hint">PNG or JPG, max 400 KB. Used on checks and exports.</p>
              </div>
            )}
          </div>

          <label className="company__label" htmlFor="co-name">Company name</label>
          <input id="co-name" className="input" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />

          <label className="company__label" htmlFor="co-address">Address</label>
          <input id="co-address" className="input" value={address} disabled={!canEdit} onChange={(e) => setAddress(e.target.value)} />

          <div className="company__row2">
            <div>
              <label className="company__label" htmlFor="co-csz">City, State ZIP</label>
              <input id="co-csz" className="input" value={cityStateZip} disabled={!canEdit} onChange={(e) => setCityStateZip(e.target.value)} />
            </div>
            <div>
              <label className="company__label" htmlFor="co-phone">Phone</label>
              <input id="co-phone" className="input" value={phone} disabled={!canEdit} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <label className="company__label" htmlFor="co-email">Email</label>
          <input id="co-email" className="input" type="email" value={email} disabled={!canEdit} onChange={(e) => setEmail(e.target.value)} />
        </section>

        <section className="company__card">
          <div className="company__card-header">
            <h3 className="company__card-title">Bank information</h3>
            {canEdit && (
              <button type="button" className="btn btn--secondary" onClick={() => setBanks((prev) => [...prev, emptyBank()])}>
                + Add bank
              </button>
            )}
          </div>

          {banks.length === 0 && (
            <p className="company__empty">No bank accounts yet. They are used for the Checkbook.</p>
          )}

          {banks.map((bank) => (
            <div className="company__bank" key={bank.id}>
              <div className="company__row2">
                <div>
                  <label className="company__label">Bank name</label>
                  <input className="input" value={bank.bankName} disabled={!canEdit}
                    onChange={(e) => patchBank(bank.id, { bankName: e.target.value })} />
                </div>
                <div>
                  <label className="company__label">Routing #</label>
                  <input className="input mono" value={bank.routing} disabled={!canEdit}
                    onChange={(e) => patchBank(bank.id, { routing: e.target.value })} />
                </div>
              </div>
              <div className="company__row2">
                <div>
                  <label className="company__label">Account #</label>
                  <input className="input mono" value={bank.account} disabled={!canEdit}
                    onChange={(e) => patchBank(bank.id, { account: e.target.value })} />
                </div>
                <div>
                  <label className="company__label">Branch address</label>
                  <input className="input" value={bank.address} disabled={!canEdit}
                    onChange={(e) => patchBank(bank.id, { address: e.target.value })} />
                </div>
              </div>
              {canEdit && (
                <button
                  type="button"
                  className="company__bank-remove"
                  onClick={() => setBanks((prev) => prev.filter((b) => b.id !== bank.id))}
                >
                  Remove bank
                </button>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
