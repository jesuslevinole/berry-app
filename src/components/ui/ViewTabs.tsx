import './ViewTabs.css';

export interface ViewTab<T extends string> {
  id: T;
  label: string;
  /** Contador opcional que se dibuja como pastilla junto a la etiqueta. */
  count?: number;
}

interface Props<T extends string> {
  tabs: Array<ViewTab<T>>;
  active: T;
  onChange: (id: T) => void;
}

/**
 * Pestanas de una vista (ordenes / detalle de lineas): estilo subrayado,
 * apoyadas sobre una linea base, como las pestanas de un cuaderno.
 */
export function ViewTabs<T extends string>({ tabs, active, onChange }: Props<T>) {
  return (
    <div className="view-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`view-tabs__tab${active === tab.id ? ' view-tabs__tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="view-tabs__label">{tab.label}</span>
          {tab.count !== undefined && <span className="view-tabs__count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
