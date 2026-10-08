export function App() {
  return (
    <div className="app-shell">
      <header className="control-panel">
        <a className="brand" href="#map-workspace" aria-label="Bounty Mapper — к рабочей области">
          <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
            <path d="M9 3v15M15 6v15" />
          </svg>
          <span>Bounty <strong>Mapper</strong></span>
        </a>
        <div className="project-state">Проект не открыт</div>
        <nav className="panel-actions" aria-label="Панель управления">
          <button type="button" disabled title="Управление проектами появится в следующей итерации">
            Проект
          </button>
          <button type="button" disabled title="Навигация станет доступна после добавления объектов">
            Навигация
          </button>
        </nav>
      </header>
      <main id="map-workspace" className="map-workspace" aria-label="Рабочая область карты" tabIndex={-1}>
        <div className="empty-state">
          <span className="workspace-label">РАБОЧАЯ ОБЛАСТЬ</span>
          <h1>Здесь будет ваша карта</h1>
          <p>Место для локаций, заметок и деталей приключения.</p>
        </div>
      </main>
    </div>
  )
}
