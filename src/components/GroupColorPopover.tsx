import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import type { TabGroup } from "../types";

interface GroupColorOption {
  key: string;
  label: string;
  value?: string;
}

const GROUP_COLOR_OPTIONS: GroupColorOption[] = [
  { key: "default", label: "Default" },
  { key: "blue", label: "Blue", value: "#8bb8ff" },
  { key: "coral", label: "Coral", value: "#f39a8b" },
  { key: "gold", label: "Gold", value: "#f6c568" },
  { key: "green", label: "Green", value: "#9bdc9e" },
  { key: "pink", label: "Pink", value: "#f08ac8" },
  { key: "purple", label: "Purple", value: "#b58cff" },
  { key: "cyan", label: "Cyan", value: "#7fd1df" },
  { key: "orange", label: "Orange", value: "#f4a261" },
];

function colorKeyForValue(value?: string) {
  return (
    GROUP_COLOR_OPTIONS.find((option) => option.value === value)?.key ??
    "default"
  );
}

export function GroupColorPopover({
  group,
  onSave,
  onCancel,
}: {
  group: TabGroup;
  onSave: (groupId: string, color?: string) => void;
  onCancel: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState(colorKeyForValue(group.color));
  const selectedOption = useMemo(
    () =>
      GROUP_COLOR_OPTIONS.find((option) => option.key === selectedKey) ??
      GROUP_COLOR_OPTIONS[0],
    [selectedKey]
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") onSave(group.id, selectedOption.value);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [group.id, onCancel, onSave, selectedOption.value]);

  return (
    <div className="icon-picker-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="icon-picker group-color-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-color-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="icon-picker-header">
          <div
            className="group-color-preview"
            style={
              selectedOption.value
                ? ({
                    "--group-color-preview": selectedOption.value,
                  } as CSSProperties)
                : undefined
            }
            aria-hidden="true"
          />
          <div>
            <span>Group color</span>
            <h2 id="group-color-title">{group.name}</h2>
          </div>
        </div>

        <div className="group-color-grid" role="listbox" aria-label="Group colors">
          {GROUP_COLOR_OPTIONS.map((option) => {
            const selected = option.key === selectedKey;
            return (
              <button
                key={option.key}
                className={
                  selected
                    ? "group-color-swatch selected"
                    : "group-color-swatch"
                }
                style={
                  option.value
                    ? ({ "--group-color": option.value } as CSSProperties)
                    : undefined
                }
                onClick={() => setSelectedKey(option.key)}
                role="option"
                aria-selected={selected}
                aria-label={option.label}
                title={option.label}
              >
                {selected && <Check size={12} />}
              </button>
            );
          })}
        </div>

        <div className="icon-picker-footer">
          <span>{selectedOption.label}</span>
          <div>
            <button onClick={onCancel}>Cancel</button>
            <button
              className="primary"
              onClick={() => onSave(group.id, selectedOption.value)}
            >
              Done
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
