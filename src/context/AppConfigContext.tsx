import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { COLLECTIONS, type AppConfigDoc, type CheckSettings, type FormFieldConfig } from '../types/models';

const CONFIG_DOC_ID = 'config';

interface AppConfigValue {
  loading: boolean;
  /** Orden configurado del menu; keys ausentes van al final en su orden natural. */
  sortNav: <T extends { key: string }>(items: T[]) => T[];
  saveNavOrder: (order: string[]) => void;
  /**
   * Config de campos de un formulario mergeada con los defaults actuales:
   * respeta orden/label/required guardados, agrega campos nuevos al final y
   * descarta claves que ya no existen.
   */
  fieldsFor: (formId: string, defaultKeys: string[]) => FormFieldConfig[];
  saveFormFields: (formId: string, fields: FormFieldConfig[]) => void;
  /** Devuelve las etiquetas (custom) de los campos obligatorios sin valor. */
  missingRequired: (formId: string, values: Record<string, unknown>) => string[];
  /** Personalizacion de cheques. */
  checkSettings: CheckSettings;
  saveCheckSettings: (settings: CheckSettings) => void;
}

const AppConfigContext = createContext<AppConfigValue | null>(null);

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfigDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onSnapshot(
      doc(db, COLLECTIONS.APP_SETTINGS, CONFIG_DOC_ID),
      (snap) => {
        setConfig(snap.exists() ? ({ id: snap.id, ...snap.data() } as AppConfigDoc) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, []);

  const value = useMemo<AppConfigValue>(() => {
    const persist = (partial: Partial<AppConfigDoc>) => {
      setDoc(doc(db, COLLECTIONS.APP_SETTINGS, CONFIG_DOC_ID), partial, { merge: true }).catch(
        (error: Error) => alert(`Failed to save configuration: ${error.message}`),
      );
    };

    const fieldsFor = (formId: string, defaultKeys: string[]): FormFieldConfig[] => {
      const saved = config?.forms?.[formId] ?? [];
      const savedValid = saved.filter((f) => defaultKeys.includes(f.key));
      const missing = defaultKeys.filter((key) => !savedValid.some((f) => f.key === key));
      return [
        ...savedValid.map((f) => ({ key: f.key, label: f.label || f.key, required: !!f.required })),
        ...missing.map((key) => ({ key, label: key, required: false })),
      ];
    };

    return {
      loading,
      sortNav: (items) => {
        const order = config?.navOrder ?? [];
        const rank = new Map(order.map((key, index) => [key, index]));
        return [...items].sort((a, b) => {
          const ra = rank.has(a.key) ? (rank.get(a.key) as number) : order.length + items.indexOf(a);
          const rb = rank.has(b.key) ? (rank.get(b.key) as number) : order.length + items.indexOf(b);
          return ra - rb;
        });
      },
      saveNavOrder: (order) => persist({ navOrder: order }),
      fieldsFor,
      checkSettings: config?.checks ?? {},
      saveCheckSettings: (settings) => persist({ checks: settings }),
      saveFormFields: (formId, fields) =>
        persist({ forms: { ...(config?.forms ?? {}), [formId]: fields } }),
      missingRequired: (formId, values) => {
        const keys = Object.keys(values);
        return fieldsFor(formId, keys)
          .filter((f) => f.required)
          .filter((f) => {
            const v = values[f.key];
            return v === undefined || v === null || String(v).trim() === '';
          })
          .map((f) => f.label);
      },
    };
  }, [config, loading]);

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppConfig(): AppConfigValue {
  const ctx = useContext(AppConfigContext);
  if (!ctx) throw new Error('useAppConfig must be used within AppConfigProvider');
  return ctx;
}
