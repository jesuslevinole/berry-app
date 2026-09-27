import './ToggleSwitch.css';

interface ToggleSwitchProps {
  on: boolean;
  onToggle: () => void;
  /** Texto accesible (aria-label y tooltip). */
  label: string;
  disabled?: boolean;
}

/**
 * Interruptor on/off reutilizable. Detiene la propagacion del clic para que
 * funcione dentro de filas clicables (DataTable abre el detalle al hacer clic).
 */
export function ToggleSwitch({ on, onToggle, label, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      className={`toggle-switch${on ? ' toggle-switch--on' : ''}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <span className="toggle-switch__knob" />
    </button>
  );
}
