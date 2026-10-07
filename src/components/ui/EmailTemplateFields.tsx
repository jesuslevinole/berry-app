import { useRef, useState } from 'react';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';
import { fillTemplate, sanitizeEmailHtml, variablesFor } from '../../services/emailTemplates';
import type { EmailDocType } from '../../types/models';
import './EmailTemplateFields.css';

interface Props {
  docType: EmailDocType;
  subject: string;
  body: string;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  /** Cambiarla recarga el editor con `body` (p. ej. al restaurar la plantilla). */
  editorKey: string;
  /** Valores reales para la vista previa (al enviar). Sin valores, se ven las variables. */
  previewValues?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Asunto + mensaje con formato y variables. Las variables ({{customer}}, {{number}}...)
 * se llenan solas en cada envio, asi la misma plantilla sirve para todas las ordenes.
 */
export function EmailTemplateFields({
  docType,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  editorKey,
  previewValues,
  disabled = false,
}: Props) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [preview, setPreview] = useState(false);
  const variables = variablesFor(docType);

  /** Inserta la variable donde esta el cursor: en el asunto si esta ahi, si no en el mensaje. */
  const insertVariable = (key: string) => {
    const token = `{{${key}}}`;
    const input = subjectRef.current;
    if (input && document.activeElement === input) {
      const start = input.selectionStart ?? subject.length;
      const end = input.selectionEnd ?? subject.length;
      const next = subject.slice(0, start) + token + subject.slice(end);
      onSubjectChange(next);
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(start + token.length, start + token.length);
      });
      return;
    }
    if (preview) setPreview(false);
    editorRef.current?.insertText(token);
  };

  return (
    <div className="email-tpl">
      <label className="email-tpl__label" htmlFor={`email-subject-${docType}`}>
        Subject <span className="email-tpl__req">*</span>
      </label>
      <input
        id={`email-subject-${docType}`}
        ref={subjectRef}
        className="input"
        value={subject}
        disabled={disabled}
        onChange={(e) => onSubjectChange(e.target.value)}
      />

      <div className="email-tpl__vars">
        <span className="email-tpl__vars-label">Insert:</span>
        {variables.map((v) => (
          <button
            key={v.key}
            type="button"
            className="email-tpl__chip"
            disabled={disabled}
            title={`Insert {{${v.key}}} — filled automatically when sending`}
            onMouseDown={(e) => {
              e.preventDefault();
              insertVariable(v.key);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="email-tpl__body-head">
        <span className="email-tpl__label">Message</span>
        {previewValues && (
          <div className="email-tpl__tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={!preview}
              className={`email-tpl__tab${!preview ? ' email-tpl__tab--active' : ''}`}
              onClick={() => setPreview(false)}
            >
              Edit
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={preview}
              className={`email-tpl__tab${preview ? ' email-tpl__tab--active' : ''}`}
              onClick={() => setPreview(true)}
            >
              Preview
            </button>
          </div>
        )}
      </div>

      {/* El editor se oculta (no se desmonta) en la vista previa para no perder el cursor. */}
      <div className={preview ? 'email-tpl__hidden' : undefined}>
        <RichTextEditor key={editorKey} ref={editorRef} initialHtml={body} onChange={onBodyChange} disabled={disabled} />
      </div>
      {preview && previewValues && (
        <div className="email-tpl__preview">
          <p className="email-tpl__preview-subject">
            <b>Subject:</b> {fillTemplate(subject, previewValues)}
          </p>
          <div
            className="email-tpl__preview-body"
            dangerouslySetInnerHTML={{ __html: fillTemplate(sanitizeEmailHtml(body), previewValues, true) }}
          />
        </div>
      )}
    </div>
  );
}
