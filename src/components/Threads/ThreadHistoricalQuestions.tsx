import { useTranslation } from 'react-i18next'

export function ThreadHistoricalQuestions({ questions }: { questions: { title: string; options: string[] | null }[] }) {
  const { t } = useTranslation('thread')
  return <aside className="thread-historical-questions" aria-label={t('historical.label')}>
    <header><strong>{t('historical.title')}</strong><small>{t('historical.unconfirmed')}</small></header>
    <p>{t('historical.body')}</p>
    {questions.map((question, index) => <div key={index}><strong>{question.title}</strong>{question.options?.length ? <ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{option}</li>)}</ul> : null}</div>)}
  </aside>
}
