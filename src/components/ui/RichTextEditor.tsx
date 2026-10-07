import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import './RichTextEditor.css';

export interface RichTextEditorHandle {
  /** Inserta texto donde esta el cursor (o al final). */
  insertText: (text: string) => void;
  /** true si el foco esta dentro del editor. */
  hasFocus: () => boolean;
}

interface Props {
  /** Contenido inicial en HTML. Para reemplazarlo, cambiar la `key` del componente. */
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const SIZES: { label: string; value: string }[] = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '6' },
];

/**
 * Editor de texto con formato para correos: negrita, cursiva, subrayado, tamano,
 * color, listas, enlaces y limpiar formato. El HTML se limpia antes de guardar/enviar.
 */
export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { initialHtml, onChange, placeholder = 'Write your message…', disabled = false },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);

  /* Contenido inicial (el editor no es controlado: React no reescribe lo que el usuario teclea). */
  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    /* Etiquetas <b>/<i>/<font> en vez de estilos en linea: mejor compatibilidad en correo. */
    document.execCommand('styleWithCSS', false, 'false');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = () => onChange(editorRef.current?.innerHTML ?? '');

  const run = (command: string, value?: string) => {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  const hasFocus = (): boolean => {
    const el = editorRef.current;
    const sel = window.getSelection();
    return !!el && !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
  };

  useImperativeHandle(ref, () => ({
    insertText: (text: string) => {
      const el = editorRef.current;
      if (!el || disabled) return;
      if (!hasFocus()) {
        /* Sin cursor en el editor: se agrega al final. */
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      document.execCommand('insertText', false, text);
      emit();
    },
    hasFocus,
  }));

  const addLink = () => {
    const url = window.prompt('Link address (https://…)', 'https://');
    if (url && /^(https?:|mailto:)/i.test(url.trim())) run('createLink', url.trim());
  };

  /* onMouseDown + preventDefault: el boton no le quita la seleccion al editor. */
  const tool = (label: string, title: string, action: () => void, className = '') => (
    <button
      type="button"
      className={`rte__btn ${className}`.trim()}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className={`rte${disabled ? ' rte--disabled' : ''}`}>
      <div className="rte__toolbar" role="toolbar" aria-label="Text formatting">
        {tool('B', 'Bold', () => run('bold'), 'rte__btn--bold')}
        {tool('I', 'Italic', () => run('italic'), 'rte__btn--italic')}
        {tool('U', 'Underline', () => run('underline'), 'rte__btn--underline')}
        {tool('S', 'Strikethrough', () => run('strikeThrough'), 'rte__btn--strike')}
        <span className="rte__sep" />
        <select
          className="rte__select"
          aria-label="Text size"
          title="Text size"
          disabled={disabled}
          value=""
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (e.target.value) run('fontSize', e.target.value);
          }}
        >
          <option value="">Size</option>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="rte__color" title="Text color">
          <span className="rte__color-a">A</span>
          <input
            type="color"
            className="rte__color-input"
            aria-label="Text color"
            disabled={disabled}
            defaultValue="#b03a2e"
            onChange={(e) => run('foreColor', e.target.value)}
          />
        </label>
        <span className="rte__sep" />
        {tool('• List', 'Bulleted list', () => run('insertUnorderedList'))}
        {tool('1. List', 'Numbered list', () => run('insertOrderedList'))}
        {tool('Link', 'Insert link', addLink)}
        <span className="rte__sep" />
        {tool('Clear', 'Remove formatting', () => run('removeFormat'))}
      </div>
      <div
        ref={editorRef}
        className="rte__area"
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Message"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
});
