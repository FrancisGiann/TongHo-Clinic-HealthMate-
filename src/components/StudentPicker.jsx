import { useEffect, useId, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { findStudentMatches, nextStudentIndex } from '../utils/studentPicker.js';

export default function StudentPicker({
  students = [],
  value = '',
  onChange,
  label = 'Student',
  required = false,
  disabled = false,
}) {
  const id = useId();
  const listId = `${id}-options`;
  const selected = students.find((student) => String(student.id) === String(value));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setQuery(selected ? `${selected.name} · ${selected.studentId}` : '');
  }, [selected?.id, selected?.name, selected?.studentId]);

  const matches = useMemo(() => {
    return findStudentMatches(students, query);
  }, [query, students]);

  const choose = (student) => {
    onChange?.(String(student.id));
    setQuery(`${student.name} · ${student.studentId}`);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => nextStudentIndex(index, 1, matches.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => nextStudentIndex(index, -1, matches.length));
    } else if (event.key === 'Enter' && open && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="student-picker">
      <label htmlFor={`${id}-input`}>{label}{required ? ' *' : ''}</label>
      <div className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-required={required}
          aria-invalid={required && !value ? 'true' : undefined}
          autoComplete="off"
          value={query}
          placeholder="Search by student name or ID"
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange?.('');
            setOpen(true);
            setActiveIndex(-1);
          }}
        />
      </div>
      {open && !disabled && (
        <div className="student-picker-options" role="listbox" id={listId} aria-label={`${label} matches`}>
          {matches.length ? matches.map((student, index) => (
            <button
              type="button"
              role="option"
              aria-selected={String(student.id) === String(value)}
              id={`${id}-option-${index}`}
              key={student.id}
              className={index === activeIndex ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(student)}
            >
              <strong>{student.name}</strong>
              <span>{student.studentId} · {student.gradeLevel || 'Grade not recorded'}{student.section ? ` · ${student.section}` : ''}</span>
            </button>
          )) : <p className="student-picker-empty">No students match that name or ID.</p>}
        </div>
      )}
      <span className="sr-only" aria-live="polite">{open ? `${matches.length} student matches` : ''}</span>
    </div>
  );
}
