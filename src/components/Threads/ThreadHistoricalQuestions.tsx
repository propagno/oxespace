export function ThreadHistoricalQuestions({ questions }: { questions: { title: string; options: string[] | null }[] }) {
  return <aside className="thread-historical-questions" aria-label="Recovered questions">
    <header><strong>Questions from this turn</strong><small>Answer not confirmed</small></header>
    <p>Recovered from the provider history. These questions cannot be answered here; no answer was inferred.</p>
    {questions.map((question, index) => <div key={index}><strong>{question.title}</strong>{question.options?.length ? <ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ul> : null}</div>)}
  </aside>
}
