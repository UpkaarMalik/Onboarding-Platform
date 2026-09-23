import { useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { CustomSelect } from './CustomSelect';

export interface Person {
  id: string;
  full_name: string;
  department: string | null;
}

/** Who can be picked as a manager or buddy: employees who have completed
 *  their own onboarding. The server decides (and re-checks on save). */
export function useEligiblePeople(): Person[] | null {
  const authedFetch = useAuthedFetch();
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    authedFetch<Person[]>('/onboardings/eligible-people')
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [authedFetch]);
  return people;
}

/** A searchable manager/buddy dropdown. '' is "nobody". `exclude` keeps the
 *  joinee themselves out of their own list. */
export default function PersonSelect({
  value,
  onChange,
  people,
  exclude,
  placeholder,
  style,
}: {
  value: string;
  onChange: (id: string) => void;
  people: Person[] | null;
  exclude?: string;
  placeholder: string;
  style?: React.CSSProperties;
}) {
  const list = (people ?? []).filter((p) => p.id !== exclude);
  return (
    <CustomSelect
      value={value}
      onChange={onChange}
      searchable
      searchPlaceholder="Search by name"
      style={style}
      placeholder={
        people === null ? 'Loading…' : list.length === 0 ? 'Nobody has completed onboarding yet' : placeholder
      }
      options={[
        ...(value ? [{ value: '', label: 'No one' }] : []),
        ...list.map((p) => ({ value: p.id, label: p.department ? `${p.full_name} · ${p.department}` : p.full_name })),
      ]}
    />
  );
}
