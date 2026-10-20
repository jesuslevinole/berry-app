import type { CSSProperties } from 'react';
import { BRAND_PRESETS, DEFAULT_BRAND_COLOR, buildBrandPalette, isBrandColor } from '../../utils/brandTheme';
import './BrandColorPicker.css';

interface BrandColorPickerProps {
  /** Color elegido (#RRGGBB); vacio = paleta original. */
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

/** Variable CSS con el color de una muestra (valor en tiempo de ejecucion). */
const swatchStyle = (color: string): CSSProperties => ({ '--swatch': color }) as CSSProperties;

/**
 * Color de marca de la empresa: muestras sugeridas, un color libre y la escala que
 * se aplicara al menu, botones y encabezados de las tablas.
 */
export const BrandColorPicker = ({ value, onChange, disabled = false }: BrandColorPickerProps) => {
  const current = isBrandColor(value) ? value : DEFAULT_BRAND_COLOR;
  const palette = Object.values(buildBrandPalette(current));
  const isDefault = current.toLowerCase() === DEFAULT_BRAND_COLOR.toLowerCase();

  return (
    <div className="brand-color">
      <div className="brand-color__presets">
        {BRAND_PRESETS.map((preset) => (
          <button
            key={preset.color}
            type="button"
            className={`brand-color__preset${preset.color.toLowerCase() === current.toLowerCase() ? ' brand-color__preset--active' : ''}`}
            style={swatchStyle(preset.color)}
            title={preset.label}
            aria-label={`Brand color ${preset.label}`}
            disabled={disabled}
            onClick={() => onChange(preset.color)}
          />
        ))}
        <label className="brand-color__custom" title="Custom color">
          <input
            type="color"
            className="brand-color__input"
            value={current}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          Custom
        </label>
        {!isDefault && (
          <button type="button" className="btn btn--secondary" disabled={disabled} onClick={() => onChange('')}>
            Default
          </button>
        )}
      </div>

      <div className="brand-color__scale" aria-hidden="true">
        {palette.map((shade) => (
          <span key={shade} className="brand-color__shade" style={swatchStyle(shade)} />
        ))}
      </div>
      <p className="brand-color__hint">
        Used in the menu, buttons and table headers. Pick a dark color so white text stays readable.
      </p>
    </div>
  );
};
