interface Props {
  onAcceptExternal: () => void;
  onOverwrite: () => void;
}

export function EditConflictDialog({ onAcceptExternal, onOverwrite }: Props) {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true">
        <span className="eyebrow">EDIT CONFLICT</span>
        <h2>外部でメモが変更されました</h2>
        <p>現在の編集を残すか、外部で変更された内容を読み込んでください。</p>
        <div className="modal-actions">
          <button onClick={onAcceptExternal}>外部の内容を読む</button>
          <button className="primary-button" onClick={onOverwrite}>
            現在の編集で上書き
          </button>
        </div>
      </section>
    </div>
  );
}
