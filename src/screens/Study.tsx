import { StudyIcon } from '../app/icons'

export function Study() {
  return (
    <div className="page">
      <p className="eyebrow">Practice and mock exams</p>
      <h1>Study</h1>
      <section className="card empty">
        <StudyIcon />
        <h2>Nothing to study yet</h2>
        <p className="muted">
          Once your book is imported and questions are created, practice sessions, timed mock exams and your
          wrong-answer notebook will live here.
        </p>
      </section>
    </div>
  )
}
