import { BookIcon } from '../app/icons'

export function Book() {
  return (
    <div className="page">
      <p className="eyebrow">Your book</p>
      <h1>Book</h1>
      <section className="card empty">
        <BookIcon />
        <h2>No book yet</h2>
        <p className="muted">
          Next build step: import your EPUB here. The app will split it into passages you can read, and that questions
          will quote word for word.
        </p>
      </section>
    </div>
  )
}
