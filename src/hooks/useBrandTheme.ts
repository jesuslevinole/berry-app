import { useEffect } from 'react';
import { useCompany } from './useCompany';
import { useActiveCompanyId } from './useActiveCompanyId';
import { applyBrandTheme, writeCachedBrand } from '../utils/brandTheme';

/**
 * Imagen grafica de la empresa activa: su color en todo el app, su nombre en la
 * pestaña del navegador y la ultima marca guardada para el login.
 */
export const useBrandTheme = () => {
  const companyId = useActiveCompanyId();
  const { company, loading } = useCompany();
  const ready = !!companyId && !loading;

  useEffect(() => {
    if (ready) applyBrandTheme(company.brandColor);
  }, [ready, company.brandColor]);

  useEffect(() => {
    if (ready && company.name) document.title = company.name;
  }, [ready, company.name]);

  useEffect(() => {
    if (!ready) return;
    writeCachedBrand({ name: company.name, logo: company.logo, color: company.brandColor ?? '' });
  }, [ready, company.name, company.logo, company.brandColor]);
};
