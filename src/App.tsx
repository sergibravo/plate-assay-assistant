import { useEffect, useRef, useState } from 'react';
import './ui/styles.css';
import { ConfirmButton } from './ui/components';
import { Module1 } from './ui/Module1';
import { Module2 } from './ui/Module2';
import { Module3 } from './ui/Module3';
import { downloadProject, loadLocal, migrate, newProject, saveLocal, type Project } from './state/project';

type TabId = 'm1' | 'm2' | 'm3' | 'm4';

const TABS: { id: TabId; label: string; ready: boolean }[] = [
  { id: 'm1', label: '1 · Transfection', ready: true },
  { id: 'm2', label: '2 · Plate layout', ready: true },
  { id: 'm3', label: '3 · Dilutions', ready: true },
  { id: 'm4', label: '4 · Reader output', ready: false },
];

export default function App() {
  const [project, setProject] = useState<Project>(() => loadLocal() ?? newProject());
  const [tab, setTab] = useState<TabId>('m1');
  const [openError, setOpenError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Autosave locally so a refresh never loses work; the JSON file is the portable copy.
  useEffect(() => {
    saveLocal(project);
  }, [project]);

  const openFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      if (!raw.version) throw new Error('that does not look like an assay project file.');
      setProject(migrate(raw));
      setOpenError(null);
    } catch (err) {
      setOpenError(`${file.name}: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <header className="app-header">
        <h1>Plate Assay Assistant</h1>
        <input
          type="text"
          value={project.name}
          onChange={(e) => setProject({ ...project, name: e.target.value })}
          aria-label="Experiment name"
        />
        <div className="spacer" />
        <ConfirmButton
          className="btn"
          confirmLabel="Discard current?"
          title="Start a new experiment — unsaved changes are lost"
          onConfirm={() => { setProject(newProject()); setOpenError(null); }}
        >
          New
        </ConfirmButton>
        <button className="btn" onClick={() => fileInput.current?.click()}>Open…</button>
        <button className="btn primary" onClick={() => downloadProject(project)}>Save project</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ''; }}
        />
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} disabled={!t.ready} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {openError && (
          <div className="msg error no-print" onClick={() => setOpenError(null)} role="alert">
            {openError}
          </div>
        )}
        {tab === 'm1' && <Module1 project={project} update={setProject} />}
        {tab === 'm2' && <Module2 project={project} update={setProject} />}
        {tab === 'm3' && <Module3 project={project} update={setProject} />}
        {tab === 'm4' && <div className="stub">Module 4 — machine-output reshaper. Stub.</div>}
      </main>
    </>
  );
}
