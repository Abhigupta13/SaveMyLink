import ExpensesClient from './ExpensesClient';

/** Server shell so page props (async params/searchParams) are not passed into the client tree. */
export default async function ExpensesPage() {
  return <ExpensesClient />;
}
