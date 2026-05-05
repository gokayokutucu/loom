import { X } from "lucide-react";
import type { AppSettings } from "../services/appSettings";

export function AppSettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation" onClick={onClose}>
      <section
        className="provider-settings app-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-settings-header">
          <div>
            <span>Settings</span>
            <h2 id="app-settings-title">App Settings</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={16} />
          </button>
        </header>

        <div className="provider-settings-body app-settings-body">
          <aside className="provider-list" aria-label="Settings sections">
            <button className="provider-row active">
              <span>
                <strong>References</strong>
                <small>Composer display</small>
              </span>
            </button>
          </aside>

          <div className="provider-detail">
            <section className="provider-section">
              <div className="provider-section-heading">
                <div>
                  <span>References</span>
                  <h3>Reference display</h3>
                </div>
              </div>

              <fieldset className="settings-segment" aria-label="Reference Display Mode">
                <legend>Reference Display Mode</legend>
                <label>
                  <input
                    type="radio"
                    name="reference-display-mode"
                    value="title"
                    checked={settings.referenceDisplayMode === "title"}
                    onChange={() =>
                      onSave({ ...settings, referenceDisplayMode: "title" })
                    }
                  />
                  <span>Title</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="reference-display-mode"
                    value="code"
                    checked={settings.referenceDisplayMode === "code"}
                    onChange={() =>
                      onSave({ ...settings, referenceDisplayMode: "code" })
                    }
                  />
                  <span>Code</span>
                </label>
              </fieldset>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
