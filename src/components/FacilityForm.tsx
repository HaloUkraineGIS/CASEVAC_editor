import { lazy, Suspense, useId } from 'react';
import { Clock3, MapPin } from 'lucide-react';
import type { FacilityField, FacilityRecord, FacilitySchema, LonLat } from '../types';

const FacilityMapPicker = lazy(() =>
  import('./FacilityMapPicker').then((module) => ({ default: module.FacilityMapPicker })),
);

interface FacilityFormProps {
  schema: FacilitySchema;
  values: Record<string, string | number>;
  errors: Record<string, string>;
  location?: LonLat;
  locationError?: string;
  facilities: FacilityRecord[];
  medics: string[];
  onChange: (name: string, value: string | number) => void;
  onLocationChange: (point: LonLat | undefined) => void;
}

function FieldControl({
  field,
  value,
  error,
  medics,
  onChange,
}: {
  field: FacilityField;
  value: string | number;
  error?: string;
  medics: string[];
  onChange: (value: string | number) => void;
}) {
  const listId = useId();
  const options = field.domain?.options ?? [];

  if (field.domain?.type === 'codedValue' && options.length > 0) {
    return (
      <select
        value={String(value ?? '')}
        className={error ? 'field-invalid' : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{field.required ? 'Оберіть значення' : '— не вказано —'}</option>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.kind === 'date') {
    return (
      <input
        type="date"
        value={String(value ?? '')}
        className={error ? 'field-invalid' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.kind === 'number') {
    return (
      <input
        type="number"
        value={String(value ?? '')}
        min={field.domain?.min}
        max={field.domain?.max}
        className={error ? 'field-invalid' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.kind === 'longText') {
    return (
      <textarea
        rows={3}
        value={String(value ?? '')}
        className={error ? 'field-invalid' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const list = listId.replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <>
      <input
        value={String(value ?? '')}
        list={medics.length > 0 ? list : undefined}
        className={error ? 'field-invalid' : undefined}
        placeholder={medics.length > 0 ? 'Оберіть зі списку або введіть ПІБ' : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {medics.length > 0 && (
        <datalist id={list}>
          {medics.map((medic) => (
            <option key={medic} value={medic} />
          ))}
        </datalist>
      )}
    </>
  );
}

/** Динамічна форма картки закладу, згенерована зі схеми шару (FR-9). */
export function FacilityForm({
  schema,
  values,
  errors,
  location,
  locationError,
  facilities,
  medics,
  onChange,
  onLocationChange,
}: FacilityFormProps) {
  const visitedBy = schema.core.visitedBy;
  const suggestMedics = (field: FacilityField): string[] => {
    if (field.name !== visitedBy) return [];
    const current = String(values[field.name] ?? '').trim();
    return current && !medics.includes(current) ? [current, ...medics] : medics;
  };

  return (
    <div className="facility-form">
      <section className="form-section form-section-map">
        <div className="form-section-head">
          <div>
            <h3>
              <MapPin size={15} />
              Точка закладу
            </h3>
            <p>Клікніть на карті, щоб поставити точку. Координати розраховуються автоматично.</p>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="facility-map-skeleton">
              <span>Готуємо карту…</span>
            </div>
          }
        >
          <FacilityMapPicker
            point={location}
            facilities={facilities}
            onPick={onLocationChange}
          />
        </Suspense>
        {locationError && <em className="form-error map-location-error">{locationError}</em>}
      </section>

      {schema.sections.map((section) => (
        <section
          key={section.id}
          className={`form-section ${section.id === 'visit' ? 'form-section-visit' : ''}`}
        >
          <div className="form-section-head">
            <div>
              <h3>{section.title}</h3>
              {section.id === 'visit' && (
                <p>
                  <Clock3 size={12} />
                  Обов’язкові поля: дата візиту та виконавець оновлюються під час кожного
                  збереження (FR-11).
                </p>
              )}
            </div>
            <span className="form-section-count">{section.fields.length}</span>
          </div>
          <div className="form-grid">
            {section.fields.map((field) => {
              const error = errors[field.name];
              const wide = field.kind === 'longText';
              return (
                <label
                  key={field.name}
                  className={`form-label ${wide ? 'form-label-wide' : ''}`}
                  title={field.description || field.name}
                >
                  <span className="field-label">
                    {field.alias}
                    {field.required && <i className="field-required">*</i>}
                  </span>
                  <FieldControl
                    field={field}
                    value={values[field.name] ?? ''}
                    error={error}
                    medics={suggestMedics(field)}
                    onChange={(value) => onChange(field.name, value)}
                  />
                  {error && <em className="form-error">{error}</em>}
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
