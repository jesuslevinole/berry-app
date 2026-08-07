import { useRef, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';
import type { EntitySchema } from '../../config/entitySchemas';
import { downloadTemplate, importCsvFile, type ImportResult } from '../../services/dataPort';
import { Modal } from './Modal';
import { FormField } from './FormField';
import './DataPortButtons.css';

interface DataPortButtonsProps {
  /** Un esquema por coleccion del modulo: cada uno es una hoja del Excel. */
  schemas: EntitySchema[];
  /** Prefijo del archivo descargado, por ejemplo "purchase-orders". */
  fileName: string;
}

/**
 * Par de acciones compartido por todos los modulos:
 * descargar la coleccion como template de Excel e importar un CSV de AppSheet.
 */
export function DataPortButtons({ schemas, fileName }: DataPortButtonsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [targetCollection, setTargetCollection] = useState(schemas[0]?.collection ?? '');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSchema = schemas.find((s) => s.collection === targetCollection) ?? schemas[0];

  const handleTemplate = async () => {
    setExporting(true);
    try {
      await downloadTemplate(schemas, fileName);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'The template could not be generated.');
    } finally {
      setExporting(false);
    }
  };

  const openImport = () => {
    setTargetCollection(schemas[0]?.collection ?? '');
    setResult(null);
    setError(null);
    setImportOpen(true);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !selectedSchema) return;
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await importCsvFile(selectedSchema, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={() => void handleTemplate()}
        disabled={exporting}
        title="Download the collection as an Excel template"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 3v12M8 11l4 4 4-4" />
          <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        {exporting ? 'Generating…' : 'Template'}
      </button>

      <button
        type="button"
        className="btn btn--secondary"
        onClick={openImport}
        title="Import records from a CSV file"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 21V9M8 13l4-4 4 4" />
          <path d="M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2" />
        </svg>
        Import CSV
      </button>

      <Modal
        title="Import CSV"
        open={importOpen}
        onClose={() => setImportOpen(false)}
        footer={
          <button type="button" className="btn btn--secondary" onClick={() => setImportOpen(false)}>
            Close
          </button>
        }
      >
        <div className="data-port">
          <p className="data-port__hint">
            Export the sheet from the Excel template as CSV and upload it here. The first column
            holds the primary key: the ID coming from AppSheet is kept as the Firestore document
            ID, so every reference between tables stays valid. Rows whose ID already exists are
            updated, never duplicated.
          </p>

          {schemas.length > 1 && (
            <FormField label="Target collection">
              <SearchableSelect
                value={targetCollection}
                onChange={(id) => {
                  setTargetCollection(id);
                  setResult(null);
                  setError(null);
                }}
                options={schemas.map((schema) => ({ id: schema.collection, name: `${schema.label} — ${schema.collection}` }))}
                placeholder="Target collection…"
              />
            </FormField>
          )}

          {selectedSchema && (
            <p className="data-port__pk">
              Primary key: <span className="mono">{selectedSchema.idField}</span>
            </p>
          )}

          <FormField label="CSV file">
            <input
              ref={fileInputRef}
              className="input data-port__file"
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
          </FormField>

          {importing && <p className="data-port__status">Importing…</p>}
          {error && <p className="data-port__error">{error}</p>}

          {result && (
            <div className="data-port__result">
              <h4 className="data-port__result-title">Import finished</h4>
              <ul className="data-port__list">
                <li>Rows read: <b className="num">{result.totalRows}</b></li>
                <li>Records written: <b className="num text-ok">{result.imported}</b></li>
                <li>With AppSheet ID: <b className="num">{result.withAppsheetId}</b></li>
                <li>With generated ID: <b className="num">{result.generatedId}</b></li>
              </ul>
              {result.errors.length > 0 && (
                <ul className="data-port__warnings">
                  {result.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
