import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { findStudentMatches, nextStudentIndex } from '../utils/studentPicker.js';
import './StudentPicker.css';

const selectedStudentLabel = (student) => `${student.name || 'Unnamed record'} · ${student.studentId || student.facultyId || student.id}`;

export default function StudentPicker({
  students = [],
  value = '',
  onChange,
  label = 'Student',
  required = false,
  disabled = false,
  itemLabel = 'patient',
  searchPlaceholder = 'Search by patient name or ID',
  description = '',
}) {
  const id = useId();
  const listId = `${id}-options`;
  const descriptionId = `${id}-description`;
  const selected = students.find((student) => String(student.id) === String(value));
  const itemPlural = `${itemLabel}s`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const editingQueryRef = useRef(false);

  useEffect(() => {
    if (selected) {
      setQuery(selectedStudentLabel(selected));
      editingQueryRef.current = false;
    } else if (editingQueryRef.current) {
      editingQueryRef.current = false;
    } else {
      setQuery('');
    }
  }, [selected?.id, selected?.name, selected?.studentId, selected?.facultyId]);

  const matches = useMemo(() => {
    const filterQuery = selected && query === selectedStudentLabel(selected) ? '' : query;
    return findStudentMatches(students, filterQuery);
  }, [query, selected, students]);

  const choose = (student) => {
    onChange?.(String(student.id));
    setQuery(selectedStudentLabel(student));
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
      if (open) { event.preventDefault(); event.stopPropagation(); }
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
          aria-describedby={description ? descriptionId : undefined}
          aria-required={required}
          aria-invalid={required && !value ? 'true' : undefined}
          autoComplete="off"
          value={query}
          placeholder={searchPlaceholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            editingQueryRef.current = true;
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
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(student)}
            >
              <strong>{student.name}</strong>
              <span>{student.studentId || student.facultyId || student.id} · {student.patientType === 'faculty' ? [student.department, student.position].filter(Boolean).join(' · ') || 'Faculty' : `${student.gradeLevel || 'Grade not recorded'}${student.section ? ` · ${student.section}` : ''}`}</span>
            </button>
          )) : <p className="student-picker-empty">{students.length ? `No ${itemPlural} match that name or ID.` : `No ${itemPlural} are available.`}</p>}
        </div>
      )}
      {description && <span className="student-picker-description field-hint" id={descriptionId}>{description}</span>}
      <span className="sr-only" aria-live="polite">{open ? `${matches.length} ${matches.length === 1 ? itemLabel : itemPlural} found` : ''}</span>
    </div>
  );
}
