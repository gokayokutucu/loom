import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, type LucideIcon } from "lucide-react";
import type { Conversation } from "../types";

export interface ConversationIconOption {
  key: string;
  label: string;
  tags: string[];
  Icon: LucideIcon;
}

function getConversationIconOption(
  options: ConversationIconOption[],
  iconKey?: string
) {
  return options.find((option) => option.key === iconKey) ?? options[0];
}

export function ChangeIconPopover({
  conversation,
  options,
  onSave,
  onCancel,
}: {
  conversation: Conversation;
  options: ConversationIconOption[];
  onSave: (conversation: Conversation, iconKey: string, title: string) => void;
  onCancel: () => void;
}) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [title, setTitle] = useState(conversation.tabLabel ?? conversation.title);
  const [query, setQuery] = useState("");
  const [selectedIconKey, setSelectedIconKey] = useState(
    conversation.iconKey ?? options[0].key
  );

  const filteredOptions = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return options;
    return options.filter((option) =>
      [option.label, option.key, ...option.tags].some((item) =>
        item.toLowerCase().includes(value)
      )
    );
  }, [options, query]);

  const selectedOption = getConversationIconOption(options, selectedIconKey);
  const SelectedIcon = selectedOption.Icon;

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave(conversation, selectedIconKey, trimmed);
  };

  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key === "Enter") handleSave();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="icon-picker-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="icon-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="icon-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="icon-picker-header">
          <div className="icon-picker-preview">
            <SelectedIcon size={20} />
          </div>
          <div>
            <span>Tab label &amp; icon</span>
            <input
              ref={titleInputRef}
              id="icon-picker-title"
              className="icon-picker-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Conversation name"
              spellCheck={false}
            />
          </div>
        </div>

        <label className="icon-search">
          <Search size={14} />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons"
            aria-label="Search icons"
          />
        </label>

        <div className="icon-grid" role="listbox" aria-label="Conversation icons">
          {filteredOptions.map((option) => {
            const selected = option.key === selectedIconKey;
            return (
              <button
                key={option.key}
                className={selected ? "icon-choice selected" : "icon-choice"}
                onClick={() => setSelectedIconKey(option.key)}
                role="option"
                aria-selected={selected}
                title={option.label}
              >
                <option.Icon size={18} />
                {selected && <Check size={12} className="icon-choice-check" />}
              </button>
            );
          })}
        </div>

        {filteredOptions.length === 0 && (
          <div className="empty-state">No matching icons.</div>
        )}

        <div className="icon-picker-footer">
          <span>{selectedOption.label}</span>
          <div>
            <button onClick={onCancel}>Cancel</button>
            <button
              className="primary"
              onClick={handleSave}
              disabled={!title.trim()}
            >
              Done
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
