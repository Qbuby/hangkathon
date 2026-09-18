"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Award, Criterion, Field } from "@/lib/activity";

type Props = {
  field: Field;
  value: unknown;
  error?: string;
  onChange: (name: string, value: unknown) => void;
};

function Label({ field, htmlFor }: { field: Field; htmlFor?: string }) {
  const text = (
    <span className="cf-label-text">
      {field.label}
      {"required" in field && field.required && <i aria-hidden="true">必填</i>}
    </span>
  );
  return htmlFor ? (
    <label className="cf-label" htmlFor={htmlFor}>{text}</label>
  ) : (
    <div className="cf-label">{text}</div>
  );
}

function Hint({ field, error }: { field: Field; error?: string }) {
  if (error) return <p className="cf-error" role="alert">{error}</p>;
  if ("help" in field && field.help) return <p className="cf-help">{field.help}</p>;
  return null;
}

function Repeater({
  label,
  onAdd,
  addLabel,
  children,
}: {
  label: string;
  onAdd: () => void;
  addLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cf-repeater">
      <span className="cf-repeater-title">{label}</span>
      {children}
      <button type="button" className="cf-add" onClick={onAdd}>
        <Plus size={15} /> {addLabel}
      </button>
    </div>
  );
}

export default function FieldControl({ field, value, error, onChange }: Props) {
  const invalid = error ? { "aria-invalid": true as const } : {};

  if (field.type === "radio") {
    return (
      <div className="cf-field">
        <Label field={field} />
        <div className="cf-options" role="radiogroup" aria-label={field.label}>
          {field.options.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`cf-option${selected ? " is-selected" : ""}`}
                onClick={() => onChange(field.name, option.value)}
              >
                <span className="cf-option-label">{option.label}</span>
                {option.hint && <span className="cf-option-hint">{option.hint}</span>}
              </button>
            );
          })}
        </div>
        <Hint field={field} error={error} />
      </div>
    );
  }

  if (field.type === "checks") {
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="cf-field">
        <Label field={field} />
        <div className="cf-options cf-options-inline">
          {field.options.map((option) => {
            const selected = picked.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="checkbox"
                aria-checked={selected}
                className={`cf-option cf-option-compact${selected ? " is-selected" : ""}`}
                onClick={() =>
                  onChange(field.name, selected ? picked.filter((v) => v !== option.value) : [...picked, option.value])
                }
              >
                <span className="cf-option-label">{option.label}</span>
              </button>
            );
          })}
        </div>
        <Hint field={field} error={error} />
      </div>
    );
  }

  if (field.type === "switch") {
    const on = value === true;
    return (
      <div className="cf-field">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`cf-switch${on ? " is-on" : ""}`}
          onClick={() => onChange(field.name, !on)}
        >
          <span className="cf-switch-track"><span className="cf-switch-thumb" /></span>
          <span className="cf-switch-text">{field.label}</span>
        </button>
        <Hint field={field} error={error} />
      </div>
    );
  }

  if (field.type === "criteria") {
    const rows = (Array.isArray(value) ? value : []) as Criterion[];
    const total = rows.reduce((sum, row) => sum + (Number(row.weight) || 0), 0);
    return (
      <div className="cf-field">
        <Label field={field} />
        <Repeater
          label={`合计 ${total}%`}
          addLabel="增加维度"
          onAdd={() => onChange(field.name, [...rows, { name: "", weight: 0 }])}
        >
          {rows.map((row, index) => (
            <div className="cf-row" key={index}>
              <input
                className="cf-input"
                value={row.name}
                placeholder="维度名称，例如 完成度"
                onChange={(event) =>
                  onChange(field.name, rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                }
              />
              <input
                className="cf-input cf-input-weight"
                type="number"
                min={0}
                max={100}
                value={row.weight}
                aria-label="权重"
                onChange={(event) =>
                  onChange(field.name, rows.map((r, i) => (i === index ? { ...r, weight: Number(event.target.value) } : r)))
                }
              />
              <span className="cf-unit">%</span>
              <button
                type="button"
                className="cf-remove"
                aria-label="删除这一项"
                onClick={() => onChange(field.name, rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </Repeater>
        <Hint field={field} error={error} />
      </div>
    );
  }

  if (field.type === "awards") {
    const rows = (Array.isArray(value) ? value : []) as Award[];
    return (
      <div className="cf-field">
        <Label field={field} />
        <Repeater
          label=""
          addLabel="增加奖项"
          onAdd={() => onChange(field.name, [...rows, { name: "", slots: 1, reward: "" }])}
        >
          {rows.map((row, index) => (
            <div className="cf-row" key={index}>
              <input
                className="cf-input"
                value={row.name}
                placeholder="奖项名称，例如 最佳作品"
                onChange={(event) =>
                  onChange(field.name, rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                }
              />
              <input
                className="cf-input cf-input-weight"
                type="number"
                min={1}
                max={99}
                value={row.slots}
                aria-label="名额"
                onChange={(event) =>
                  onChange(field.name, rows.map((r, i) => (i === index ? { ...r, slots: Number(event.target.value) } : r)))
                }
              />
              <span className="cf-unit">名</span>
              <input
                className="cf-input cf-input-reward"
                value={row.reward}
                placeholder="奖励说明（可留空）"
                onChange={(event) =>
                  onChange(field.name, rows.map((r, i) => (i === index ? { ...r, reward: event.target.value } : r)))
                }
              />
              <button
                type="button"
                className="cf-remove"
                aria-label="删除这一项"
                onClick={() => onChange(field.name, rows.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </Repeater>
        <Hint field={field} error={error} />
      </div>
    );
  }

  const shared = {
    id: field.name,
    className: `cf-input${field.type === "number" ? " cf-input-weight" : ""}`,
    value: value === undefined || value === null ? "" : String(value),
    placeholder: "placeholder" in field ? field.placeholder : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(field.name, event.target.value),
    ...invalid,
  };

  return (
    <div className={`cf-field${"half" in field && field.half ? " cf-half" : ""}`}>
      <Label field={field} htmlFor={field.name} />
      {field.type === "textarea" ? (
        <textarea {...shared} rows={5} />
      ) : (
        <input
          {...shared}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          min={"min" in field ? field.min : undefined}
          max={"max" in field ? field.max : undefined}
        />
      )}
      <Hint field={field} error={error} />
    </div>
  );
}
