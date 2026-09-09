import { useRef, useState } from 'react';
import { SearchableSelect } from './SearchableSelect';
import type { EntitySchema } from '../../config/entitySchemas';
import { downloadTemplate, importCsvFile, previewCsvFile, type CsvPreview, type ImportResult } from '../../services/dataPort';
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
  /* Paso de mapeo: el usuario confirma que columna del CSV va a cada campo. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [idIndex, setIdIndex] = useState(-1);
  const [replaceLines, setReplaceLines] = useState(true);

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

  const resetImport = () => {
    setResult(null);
    setError(null);
    setPendingFile(null);
    setPreview(null);
    setMapping({});
    setIdIndex(-1);
  };

  const openImport = () => {
    setTargetCollection(schemas[0]?.collection ?? '');
    resetImport();
    setImportOpen(true);
  };

  /** Paso 1: leer encabezados y proponer el mapeo automatico. */
  const handleFile = async (file: File | undefined) => {
    if (!file || !selectedSchema) return;
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const csv = await previewCsvFile(selectedSchema, file);
      setPendingFile(file);
      setPreview(csv);
      setMapping(csv.mapping);
      setIdIndex(csv.idIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be read.');
    } finally {
      setImporting(false);
    }
  };

  /** Paso 2: importar con el mapeo confirmado por el usuario. */
  const runImport = async () => {
    if (!pendingFile || !selectedSchema) return;
    setImporting(true);
    setError(null);
    try {
      setResult(
        await importCsvFile(selectedSchema, pendingFile, {
          mapping,
          idIndex,
          replaceChildrenByParent: !!selectedSchema.parentField && replaceLines,
        }),
      );
      setPendingFile(null);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be imported.');
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

          {preview && selectedSchema && (
            <div className="data-port__mapping">
              <h4 className="data-port__result-title">Match the columns ({preview.rowCount} rows)</h4>
              <p className="data-port__hint-small">
                Pick which column of your file feeds each field. Anything left as "Not in file" is saved empty.
              </p>

              <label className="data-port__map-row">
                <span className="data-port__map-label">{selectedSchema.idField} (primary key)</span>
                <select className="input" value={idIndex} onChange={(e) => setIdIndex(Number(e.target.value))}>
                  <option value={-1}>Generate new IDs</option>
                  {preview.headers.map((header, i) => (
                    <option key={`${header}-${i}`} value={i}>{header}</option>
                  ))}
                </select>
              </label>

              {selectedSchema.fields.map((field) => (
                <label className="data-port__map-row" key={field.key}>
                  <span className="data-port__map-label">{field.key}</span>
                  <select
                    className="input"
                    value={mapping[field.key] ?? -1}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                  >
                    <option value={-1}>Not in file</option>
                    {preview.headers.map((header, i) => (
                      <option key={`${header}-${i}`} value={i}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}

              {selectedSchema.parentField && (
                <label className="data-port__replace">
                  <input
                    type="checkbox"
                    checked={replaceLines}
                    onChange={(e) => setReplaceLines(e.target.checked)}
                  />
                  Replace the existing line items of every order in this file (recommended: avoids duplicates when
                  re-importing)
                </label>
              )}

              <button type="button" className="btn btn--primary" disabled={importing} onClick={() => void runImport()}>
                {importing ? 'Importing\u2026' : 'Import with this mapping'}
              </button>
            </div>
          )}

          {importing && <p className="data-port__status">Working…</p>}
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
